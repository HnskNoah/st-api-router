// 按 realModel 粒度的被动健康检测与熔断（纯函数，无 ST 依赖）。
// 核心原则：可用性状态细化到「GroupEntry(Key) × realModel」粒度，不误伤同 Key 的其他模型。
// 所有状态更新来自真实请求结果，不主动探测。

import type { GroupEntry, ModelFailureKind, ModelObservationKind, ModelObservationRecord } from '../types.js';

export const MODEL_OBSERVATION_HISTORY_LIMIT = 200;
export const MODEL_OBSERVATION_RECORDED_EVENT = 'quicker-api:model-observation-recorded';

export interface RecordModelFailureOptions {
    /** 连续失败几次触发冷却。默认 3（复用 RoutingSettings.failThreshold）。 */
    threshold?: number;
    /** 所有可冷却错误统一使用的基础冷却时长（ms）。默认 300_000。 */
    baseCooldownMs?: number;
    /** 指数退避倍数上限。默认 32。 */
    maxCooldownMultiplier?: number;
}

/** 追加一条全局观测并删除最早记录，保持总窗口有界。 */
export function appendModelObservation(
    history: ModelObservationRecord[] | undefined,
    record: ModelObservationRecord,
): ModelObservationRecord[] {
    const target = history ?? [];
    target.push({ ...record, message: String(record.message ?? '').slice(0, 500) });
    if (target.length > MODEL_OBSERVATION_HISTORY_LIMIT) {
        target.splice(0, target.length - MODEL_OBSERVATION_HISTORY_LIMIT);
    }
    return target;
}

// ── 错误分类 ──

/** 从宿主错误提示或 API 错误正文推断错误分类（纯被动，无 HTTP 返回码）。 */
export function classifyModelFailureMessage(msg: string): ModelFailureKind {
    const m = String(msg ?? '').toLowerCase();
    // 不可恢复：模型不存在 / 余额不足 / 无权限 / key 无效 / 封禁
    if (/(model[_ -]?not[_ -]?found|no such model|model .* not exist|insufficient[_ -]?quota|no quota|quota exhausted|balance|\b401\b|\b403\b|permission|banned|invalid api key|account disabled|access denied|forbidden|unauthorized|payment required|模型不存在|模型未找到|余额不足|配额不足|无效(?:的)?(?: api ?key|密钥)|密钥无效|无权限|禁止访问|账户禁用|账号禁用|欠费)/i.test(m)) {
        return 'fatal';
    }
    // 限流
    if (/(\b429\b|rate ?limit|too many requests|rate limit exceeded|quota exceeded|限流|请求过多|频率限制|配额超限)/i.test(m)) {
        return 'rate_limited';
    }
    // 参数错误：不是渠道故障，不处理
    if (/(\b400\b|bad request|parameter|invalid request|invalid parameter|format|invalid input|validation error|请求无效|参数错误|参数无效|格式错误|验证失败)/i.test(m)) {
        return 'bad_request';
    }
    // 网络类错误 / 超时 / 服务端错误 → temp
    if (/(failed to fetch|load failed|network|timed out|abort|timeout|5\d{2}|server error|service unavailable|internal error|网络|超时|服务(?:暂时)?不可用|服务器错误|内部错误|连接失败)/i.test(m)) {
        return 'temp';
    }
    return 'unknown';
}

// ── 成功处理 ──

/** 生成成功 → 该 Key 上该 realModel 恢复健康。清除冷却、失败计数、错误记录。 */
export function recordModelSuccess(entry: GroupEntry, realModel: string): void {
    if (!entry) return;
    delete entry.failStreakByModel?.[realModel];
    delete entry.circuitsByModel?.[realModel];
    if (entry.cooldownMultiplierByModel) {
        entry.cooldownMultiplierByModel[realModel] = 1;
    }
    if (entry.lastErrorByRealModel) {
        delete entry.lastErrorByRealModel[realModel];
    }
    if (entry.lastErrorKindByModel) {
        delete entry.lastErrorKindByModel[realModel];
    }
}

/** 记录结果观测但不改变健康状态；用于空回复等不算失败的情况。 */
export function recordModelObservation(entry: GroupEntry, realModel: string, kind: ModelObservationKind, message: string): void {
    if (!entry) return;
    entry.lastErrorByRealModel ??= {};
    entry.lastErrorKindByModel ??= {};
    entry.lastErrorByRealModel[realModel] = String(message ?? '').slice(0, 500);
    entry.lastErrorKindByModel[realModel] = kind;
}

// ── 失败处理 ──

/** 记录该 Key 上 realModel 的一次失败。所有进入冷却的分类统一使用阈值 + 指数退避公式。 */
export function recordModelFailure(
    entry: GroupEntry,
    realModel: string,
    kind: ModelFailureKind,
    error: string,
    opts: RecordModelFailureOptions = {},
    now = Date.now(),
): boolean {
    const base = Math.max(1, Math.floor(Number(opts.baseCooldownMs) || 300_000));
    const threshold = Math.max(1, Math.floor(Number(opts.threshold) || 3));
    const maxMul = Math.max(1, Math.floor(Number(opts.maxCooldownMultiplier) || 32));

    entry.lastErrorByRealModel ??= {};
    entry.lastErrorKindByModel ??= {};
    entry.lastErrorByRealModel[realModel] = String(error ?? '').slice(0, 500);
    entry.lastErrorKindByModel[realModel] = kind;

    // 参数错误不是渠道故障，不进入健康失败计数。
    if (kind === 'bad_request') return false;

    entry.failStreakByModel ??= {};
    entry.cooldownMultiplierByModel ??= {};
    const immediate = kind === 'fatal' || kind === 'rate_limited';
    const streak = (Number(entry.failStreakByModel[realModel]) || 0) + 1;
    entry.failStreakByModel[realModel] = streak;
    if (!immediate && streak < threshold) return false;

    const mul = Math.min(
        Math.max(1, Math.floor(Number(entry.cooldownMultiplierByModel[realModel]) || 1)),
        maxMul,
    );
    entry.circuitsByModel ??= {};
    entry.circuitsByModel[realModel] = now + base * mul;
    entry.cooldownMultiplierByModel[realModel] = Math.min(mul * 2, maxMul);
    delete entry.failStreakByModel[realModel];
    return true;
}
export function isModelInCooldown(entry: GroupEntry | null | undefined, realModel: string | null | undefined, now = Date.now()): boolean {
    if (!entry || !realModel) return false;
    const until = entry.circuitsByModel?.[realModel];
    return Boolean(until && now < until);
}

/** 返回该 Key 上 realModel 的冷却剩余毫秒数（0 = 无冷却或已过期）。 */
export function modelCooldownRemainingMs(entry: GroupEntry | null | undefined, realModel: string | null | undefined, now = Date.now()): number {
    if (!entry || !realModel) return 0;
    const until = entry.circuitsByModel?.[realModel];
    if (!until) return 0;
    const remaining = until - now;
    return remaining > 0 ? remaining : 0;
}