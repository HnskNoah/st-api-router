// Group 路由引擎：逻辑模型 → 承载 Vendor/Key 条目 → Vendor 级可用性过滤 → 模型级冷却过滤 → 成功率加权随机。
// RPM 与失败禁用均为 Vendor 级；模型级冷却在「Key × realModel」粒度独立，同 Key 不同模型互不影响。

import type { Group, GroupEntry, Vendor, VendorModelMapping } from '../types.js';
import { isModelInCooldown } from './model-health.js';
import { vendorEffectiveWeight } from './vendor.js';

export const GROUP_RPM_WINDOW_MS = 60 * 1000;

export interface GroupRouteUnit {
    vendor: Vendor;
    entry: GroupEntry;
    mapping: VendorModelMapping;
    realModel: string;
}

export interface GroupRouteResult {
    unit: GroupRouteUnit | null;
    reasons: string[];
    nextLastPicked: GroupRouteSticky | null;
}

export interface GroupRouteSticky {
    unitKey: string;
    /** 剩余可消费次数（0 = 本次消费后归零，不再复用）。 */
    remaining: number;
}

export function rpmWindow(vendor: Vendor, now: number): { window: number[]; count: number } {
    const cutoff = now - GROUP_RPM_WINDOW_MS;
    const window = (vendor?.window || []).filter(ts => typeof ts === 'number' && ts > cutoff);
    return { window, count: window.length };
}

export function vendorRpmAvailable(vendor: Vendor, now: number): boolean {
    const rpm = Number(vendor?.rpm) || 0;
    if (rpm <= 0) return true;
    return rpmWindow(vendor, now).count < rpm;
}

export function groupUnitUnavailabilityReason(unit: GroupRouteUnit, now: number): string | null {
    if (!unit?.vendor || !unit?.entry || !unit?.mapping) return 'missing';
    if (unit.vendor.enabled === false) return 'disabled';
    if (unit.entry.enabled === false) return 'disabled';
    if (!vendorRpmAvailable(unit.vendor, now)) return 'rpm';
    const modelReason = modelUnitUnavailabilityReason(unit, now);
    if (modelReason) return modelReason;
    return null;
}

/** 模型级冷却检查：该 Key 上该 realModel 是否处于冷却中。同 Key 不同模型互不影响。 */
export function modelUnitUnavailabilityReason(unit: GroupRouteUnit, now: number): string | null {
    if (!unit?.entry || !unit?.realModel) return null;
    if (isModelInCooldown(unit.entry, unit.realModel, now)) return 'cooldown';
    return null;
}

/** 该 Group 中能承载指定逻辑模型的所有条目（不做可用性过滤）。
 *  模型数据按 Key 级存放：只有该 Key 自己的 mappings 含该逻辑模型才可承载（部分模型只在特定 Key 上可获取）。 */
export function groupUnitsForLogicalModel(vendors: Vendor[], group: Group | null | undefined, logicalModelId: string): GroupRouteUnit[] {
    if (!group || !logicalModelId || !Array.isArray(group.entries)) return [];
    const units: GroupRouteUnit[] = [];
    for (const entry of group.entries) {
        const vendor = (vendors || []).find(item => item.id === entry.vendorId);
        if (!vendor) continue;
        for (const mapping of entry.mappings ?? []) {
            if (mapping.logicalModelId !== logicalModelId) continue;
            units.push({ vendor, entry, mapping, realModel: mapping.realModel });
        }
    }
    return units;
}

/** 可选候选：Vendor/条目启用、RPM 有余量且模型未冷却。 */
export function candidateGroupUnits(vendors: Vendor[], group: Group | null | undefined, logicalModelId: string, now = Date.now()): GroupRouteUnit[] {
    return groupUnitsForLogicalModel(vendors, group, logicalModelId)
        .filter(unit => !groupUnitUnavailabilityReason(unit, now));
}

function positiveWeight(value: unknown): number {
    const weight = Number(value);
    return Number.isFinite(weight) && weight > 0 ? weight : 1;
}

function pickWeighted<T>(items: T[], weightOf: (item: T) => number): T | null {
    if (!Array.isArray(items) || items.length === 0) return null;
    if (items.length === 1) return items[0] ?? null;
    const weights = items.map(item => positiveWeight(weightOf(item)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) return items[0] ?? null;
    let roll = Math.random() * total;
    for (let index = 0; index < items.length; index++) {
        roll -= weights[index];
        if (roll <= 0) return items[index] ?? null;
    }
    return items[items.length - 1] ?? null;
}

function channelWeight(unit: GroupRouteUnit): number {
    return positiveWeight(unit?.entry?.weight) * positiveWeight(unit?.mapping?.weight);
}

/** 两阶段加权随机：先按 Vendor 选择，再在 Vendor 内按 Key × 真实模型映射选择。 */
export function pickGroupUnit(candidates: GroupRouteUnit[]): GroupRouteUnit | null {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const byVendor = new Map<string, GroupRouteUnit[]>();
    for (const unit of candidates) {
        const vendorId = unit?.vendor?.id ?? '';
        const units = byVendor.get(vendorId);
        if (units) units.push(unit);
        else byVendor.set(vendorId, [unit]);
    }
    const vendorGroups = [...byVendor.values()].map(units => ({
        vendor: units[0]!.vendor,
        units,
    }));
    const selectedVendor = pickWeighted(vendorGroups, group => vendorEffectiveWeight(group.vendor));
    return selectedVendor ? pickWeighted(selectedVendor.units, channelWeight) : null;
}

/** 记录本次选路（Vendor 全局限流窗口）。 */
export function recordGroupSelection(unit: GroupRouteUnit, now = Date.now()): void {
    const vendor = unit?.vendor;
    if (!vendor) return;
    const { window } = rpmWindow(vendor, now);
    window.push(now);
    vendor.window = window;
}

/** 汇总承载该逻辑模型但不可用的 Vendor 原因。 */
export function summarizeGroupUnavailable(vendors: Vendor[], group: Group | null | undefined, logicalModelId: string, now = Date.now()): string[] {
    const reasons: string[] = [];
    for (const unit of groupUnitsForLogicalModel(vendors, group, logicalModelId)) {
        const reason = groupUnitUnavailabilityReason(unit, now);
        if (reason) reasons.push(`${unit.vendor.name} / ${unit.entry.label}：${reason}`);
    }
    return reasons;
}

/** 路由单元唯一标识：sticky 必须区分同一 Key 下的不同真实模型映射。 */
export function groupUnitKey(unit: GroupRouteUnit): string {
    const mappingId = unit?.mapping?.id || unit?.realModel || '';
    return `${unit?.vendor?.id ?? ''}::${unit?.entry?.id ?? ''}::${mappingId}`;
}

export interface AutoRetryDecision {
    canRetry: boolean;
    /** 本次重试是第几次（1 起）。 */
    attempt: number;
}

/** 自动重试决策：开启、未达上限且环境允许时换路由重试。 */
export function evaluateAutoRetry(opts: {
    autoRetryCount: number;
    retriesUsed: number;
    routingEnabled: boolean;
    extensionDisabled: boolean;
    presetTransitionBlocked: boolean;
    groupIntact: boolean;
}): AutoRetryDecision {
    const max = Math.floor(Number(opts.autoRetryCount) || 0);
    if (max <= 0 || opts.retriesUsed >= max) return { canRetry: false, attempt: opts.retriesUsed + 1 };
    if (!opts.routingEnabled || opts.extensionDisabled || opts.presetTransitionBlocked || !opts.groupIntact) {
        return { canRetry: false, attempt: opts.retriesUsed + 1 };
    }
    return { canRetry: true, attempt: opts.retriesUsed + 1 };
}

export function routeGroupOnce(
    vendors: Vendor[],
    group: Group | null | undefined,
    logicalModelId: string,
    { now = Date.now(), stickyCount = 0, lastPicked = null, excludeKeys = [] }: {
        now?: number;
        stickyCount?: number;
        lastPicked?: GroupRouteSticky | null;
        /** 本次调用排除的单元 key（如自动重试链中已失败的渠道）。 */
        excludeKeys?: string[];
    } = {},
): GroupRouteResult {
    let candidates = candidateGroupUnits(vendors, group, logicalModelId, now);
    if (excludeKeys.length > 0) {
        const excluded = new Set(excludeKeys);
        candidates = candidates.filter(unit => !excluded.has(groupUnitKey(unit)));
    }
    if (candidates.length === 0) {
        const reasons = summarizeGroupUnavailable(vendors, group, logicalModelId, now);
        if (reasons.length === 0) {
            reasons.push(excludeKeys.length > 0 ? '候选均已在本轮重试中失败（已排除）' : '当前 Group 未配置该逻辑模型的 Vendor 映射');
        }
        return { unit: null, reasons, nextLastPicked: null };
    }
    let unit = pickGroupUnit(candidates);
    // sticky：按次。上次选中的 unit 还有剩余次数且仍可用时复用
    if (stickyCount > 0 && lastPicked && lastPicked.remaining > 0) {
        unit = candidates.find(item => groupUnitKey(item) === lastPicked.unitKey) || unit;
    }
    if (!unit) return { unit: null, reasons: ['无可选候选'], nextLastPicked: null };
    recordGroupSelection(unit, now);
    // sticky 返回：复用上一次 → 剩余次数减 1；新选 → 用 stickyCount-1 作为新剩余次数
    const isReused = Boolean(lastPicked && stickyCount > 0 && lastPicked.remaining > 0 && groupUnitKey(unit) === lastPicked.unitKey);
    const nextRemaining = isReused ? Math.max(0, lastPicked!.remaining - 1) : (stickyCount > 0 ? stickyCount - 1 : 0);
    return {
        unit,
        reasons: [],
        nextLastPicked: stickyCount > 0
            ? { unitKey: groupUnitKey(unit), remaining: nextRemaining }
            : null,
    };
}
