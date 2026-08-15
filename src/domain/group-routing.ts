// Group 路由引擎：逻辑模型 → 承载 Vendor/Key 条目 → Vendor 级可用性过滤 → 成功率加权随机。
// RPM 与失败禁用均为 Vendor 级；一个逻辑模型可以同时被多个 Group、多个 Vendor 承载。

import type { Group, GroupEntry, Vendor, VendorModelMapping } from '../types.js';
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
    return null;
}

/** 该 Group 中能承载指定逻辑模型的所有条目（不做可用性过滤）。 */
export function groupUnitsForLogicalModel(vendors: Vendor[], group: Group | null | undefined, logicalModelId: string): GroupRouteUnit[] {
    if (!group || !logicalModelId || !Array.isArray(group.entries)) return [];
    const units: GroupRouteUnit[] = [];
    for (const entry of group.entries) {
        const vendor = (vendors || []).find(item => item.id === entry.vendorId);
        const mapping = vendor?.mappings?.find(item => item.logicalModelId === logicalModelId);
        if (!vendor || !mapping) continue;
        units.push({ vendor, entry, mapping, realModel: mapping.realModel });
    }
    return units;
}

/** 可选候选：Vendor/条目启用且 RPM 有余量。 */
export function candidateGroupUnits(vendors: Vendor[], group: Group | null | undefined, logicalModelId: string, now = Date.now()): GroupRouteUnit[] {
    return groupUnitsForLogicalModel(vendors, group, logicalModelId)
        .filter(unit => !groupUnitUnavailabilityReason(unit, now));
}

/** 成功率加权随机选一个条目。 */
export function pickGroupUnit(candidates: GroupRouteUnit[]): GroupRouteUnit | null {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const total = candidates.reduce((sum, unit) => sum + vendorEffectiveWeight(unit.vendor), 0);
    if (total <= 0) return candidates[0] ?? null;
    let roll = Math.random() * total;
    for (const unit of candidates) {
        roll -= vendorEffectiveWeight(unit.vendor);
        if (roll <= 0) return unit;
    }
    return candidates[candidates.length - 1] ?? null;
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

export function routeGroupOnce(
    vendors: Vendor[],
    group: Group | null | undefined,
    logicalModelId: string,
    { now = Date.now() }: { now?: number } = {},
): GroupRouteResult {
    const candidates = candidateGroupUnits(vendors, group, logicalModelId, now);
    if (candidates.length === 0) {
        const reasons = summarizeGroupUnavailable(vendors, group, logicalModelId, now);
        if (reasons.length === 0) reasons.push('当前 Group 未配置该逻辑模型的 Vendor 映射');
        return { unit: null, reasons };
    }
    const unit = pickGroupUnit(candidates);
    if (!unit) return { unit: null, reasons: ['无可选候选'] };
    recordGroupSelection(unit, now);
    return { unit, reasons: [] };
}
