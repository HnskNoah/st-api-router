// 路由引擎（key 粒度，熔断按模型）：候选过滤 → 加权随机选择 → RPM 限流 → 熔断状态机。
// 熔断针对（key × 模型）：一个模型熔断后，同 key 的其他模型仍可选；RPM 窗口独立于熔断。
// sticky 按「绝对时间」：窗口内固定 key，换对话/角色/模型都不重置；到期重选。
// 纯函数，可独立测试。

import { DEFAULT_ROUTING_SETTINGS } from '../constants.js';
import { unitId, unitsCarryingModel } from './model-catalog.js';
import type { LastPicked, Provider, ProviderKey, RouteResult, RoutingSettings, RoutingUnit } from '../types.js';

export const RPM_WINDOW_MS = 60 * 1000;
export const FAIL_THRESHOLD_DEFAULT = 3;
export const COOLDOWN_MS_DEFAULT = 60 * 1000;
export const STICKY_SECONDS_DEFAULT = 600;

/** 规范化路由设置（载入时迁移用，与 DEFAULT_ROUTING_SETTINGS 语义一致）。 */
export function normalizeRoutingSettings(raw: unknown): RoutingSettings {
    const routing = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
    return {
        enabled: Boolean(routing.enabled),
        stickySeconds: Number.isFinite(Number(routing.stickySeconds)) && Number(routing.stickySeconds) >= 0
            ? Math.floor(Number(routing.stickySeconds))
            : DEFAULT_ROUTING_SETTINGS.stickySeconds,
        failThreshold: Number.isFinite(Number(routing.failThreshold)) && Number(routing.failThreshold) > 0
            ? Math.floor(Number(routing.failThreshold))
            : DEFAULT_ROUTING_SETTINGS.failThreshold,
        cooldownSeconds: Number.isFinite(Number(routing.cooldownSeconds)) && Number(routing.cooldownSeconds) > 0
            ? Math.floor(Number(routing.cooldownSeconds))
            : DEFAULT_ROUTING_SETTINGS.cooldownSeconds,
    };
}

/** 该 key 对指定模型是否处于熔断中。 */
export function isModelCircuitOpen(key: ProviderKey, model: string, now: number): boolean {
    const until = key?.circuits?.[model];
    return Boolean(until && now < until);
}

/** 窗口内的时间戳列表与计数（不修改 key，返回过滤后的新数组）。 */
export function rpmWindow(key: ProviderKey, now: number): { window: number[]; count: number } {
    const cutoff = now - RPM_WINDOW_MS;
    const window = (key?.window || []).filter(ts => typeof ts === 'number' && ts > cutoff);
    return { window, count: window.length };
}

export function rpmAvailable(key: ProviderKey, now: number): boolean {
    const rpm = Number(key?.rpm) || 0;
    if (rpm <= 0) return true;
    return rpmWindow(key, now).count < rpm;
}

/** 返回单元对指定模型不可用原因；可用返回 null。 */
export function unavailabilityReason(unit: RoutingUnit, model: string, now: number): string | null {
    const provider = unit?.provider;
    const key = unit?.key;
    if (!provider || !key) return 'missing';
    if (provider.enabled === false) return 'disabled';
    if (key.enabled === false) return 'disabled';
    if (isModelCircuitOpen(key, model, now)) return 'circuit';
    if (!rpmAvailable(key, now)) return 'rpm';
    return null;
}

/** 可选候选单元：承载该模型 且 provider/key enabled、该模型未熔断、rpm 有余量。 */
export function candidateUnits(providers: Provider[], model: string, now = Date.now()): RoutingUnit[] {
    const candidates: RoutingUnit[] = [];
    for (const unit of unitsCarryingModel(providers, model)) {
        if (!unavailabilityReason(unit, model, now)) candidates.push(unit);
    }
    return candidates;
}

/** 加权随机挑一个单元（key.weight <= 0 视为 1）。 */
export function pickUnit(candidates: RoutingUnit[]): RoutingUnit | null {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const total = candidates.reduce((sum, unit) => sum + (Number(unit?.key?.weight) > 0 ? Number(unit.key.weight) : 1), 0);
    let roll = Math.random() * total;
    for (const unit of candidates) {
        roll -= (Number(unit?.key?.weight) > 0 ? Number(unit.key.weight) : 1);
        if (roll <= 0) return unit;
    }
    return candidates[candidates.length - 1] ?? null;
}

/** 记录本次选路（写入 key 的 rpm 窗口；不触碰熔断状态）。 */
export function recordSelection(unit: RoutingUnit, now = Date.now()): void {
    const key = unit?.key;
    if (!key) return;
    const { window } = rpmWindow(key, now);
    window.push(now);
    key.window = window;
}

export function recordSuccess(unit: RoutingUnit, model: string): void {
    const key = unit?.key;
    if (!key) return;
    delete key.failStreakByModel[model];
    key.lastError = '';
}

/** 记录失败（针对模型）：连续失败达阈值 → 该模型熔断（冷却结束自动恢复）；同 key 其他模型不受影响。 */
export function recordFailure(
    unit: RoutingUnit,
    model: string,
    error: string,
    { threshold = FAIL_THRESHOLD_DEFAULT, cooldownMs = COOLDOWN_MS_DEFAULT }: { threshold?: number; cooldownMs?: number } = {},
    now = Date.now(),
): void {
    const key = unit?.key;
    if (!key) return;
    const streak = (Number(key.failStreakByModel[model]) || 0) + 1;
    key.lastError = String(error ?? '').slice(0, 500);
    if (streak >= threshold) {
        key.circuits[model] = now + cooldownMs;
        delete key.failStreakByModel[model];
    } else {
        key.failStreakByModel[model] = streak;
    }
}

/** 汇总「承载该模型但不可用」的单元及原因（toast 展示用）。 */
export function summarizeUnavailable(providers: Provider[], model: string, now = Date.now()): string[] {
    const reasons: string[] = [];
    for (const unit of unitsCarryingModel(providers, model)) {
        const reason = unavailabilityReason(unit, model, now);
        if (reason) reasons.push(`${unit.provider?.name} / ${unit.key?.label}：${reason}`);
    }
    return reasons;
}

/**
 * 完整一次选路（key 粒度）：
 * - stickySeconds > 0 且上次单元未到期且仍可用 → 复用；
 * - 否则加权随机挑一个。
 */
export function routeOnce(
    providers: Provider[],
    model: string,
    { stickySeconds = 0, lastPicked = null, now = Date.now() }: { stickySeconds?: number; lastPicked?: LastPicked | null; now?: number } = {},
): RouteResult {
    const candidates = candidateUnits(providers, model, now);
    if (candidates.length === 0) {
        return { unit: null, reasons: summarizeUnavailable(providers, model, now), nextLastPicked: null };
    }
    let unit: RoutingUnit | null = pickUnit(candidates);
    if (stickySeconds > 0 && lastPicked && now < lastPicked.until) {
        unit = candidates.find(item => unitId(item) === lastPicked.unitId) || unit;
    }
    if (!unit) {
        return { unit: null, reasons: ['无可选候选'], nextLastPicked: null };
    }
    recordSelection(unit, now);
    return {
        unit,
        reasons: [],
        nextLastPicked: stickySeconds > 0
            ? { unitId: unitId(unit), until: now + stickySeconds * 1000 }
            : null,
    };
}
