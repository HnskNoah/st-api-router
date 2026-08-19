import { describe, it, expect } from 'vitest';
import { classifyModelFailureMessage, recordModelFailure, recordModelSuccess, isModelInCooldown, modelCooldownRemainingMs, type RecordModelFailureOptions } from '../src/domain/model-health.js';
import type { GroupEntry, ModelFailureKind } from '../src/types.js';

function makeEntry(overrides?: Partial<GroupEntry>): GroupEntry {
    return {
        id: 'e1',
        vendorId: 'v1',
        apiKey: 'sk-xxx',
        label: 'Test Key',
        enabled: true,
        fetchedModels: [],
        mappings: [],
        ...overrides,
    };
}

const defaultOpts: RecordModelFailureOptions = {
    threshold: 2,
    baseCooldownMs: 300_000,
    fatalCooldownMs: 6 * 3600_000,
    rateLimitCooldownMs: 30_000,
    maxCooldownMultiplier: 32,
};

// ── classifyModelFailureMessage ──

describe('classifyModelFailureMessage', () => {
    it('classifies fatal: model_not_found', () => {
        expect(classifyModelFailureMessage('model_not_found')).toBe('fatal');
        expect(classifyModelFailureMessage('Model Not Found')).toBe('fatal');
        expect(classifyModelFailureMessage('no such model "gpt-4o"')).toBe('fatal');
        expect(classifyModelFailureMessage('model xxx does not exist')).toBe('fatal');
    });

    it('classifies fatal: insufficient_quota / balance', () => {
        expect(classifyModelFailureMessage('insufficient_quota')).toBe('fatal');
        expect(classifyModelFailureMessage('Insufficient Quota')).toBe('fatal');
        expect(classifyModelFailureMessage('no quota')).toBe('fatal');
        expect(classifyModelFailureMessage('quota exhausted')).toBe('fatal');
        expect(classifyModelFailureMessage('balance not enough')).toBe('fatal');
    });

    it('classifies fatal: 401/403/permission', () => {
        expect(classifyModelFailureMessage('401 Unauthorized')).toBe('fatal');
        expect(classifyModelFailureMessage('403 Forbidden')).toBe('fatal');
        expect(classifyModelFailureMessage('permission denied')).toBe('fatal');
        expect(classifyModelFailureMessage('invalid api key')).toBe('fatal');
        expect(classifyModelFailureMessage('account disabled')).toBe('fatal');
        expect(classifyModelFailureMessage('access denied')).toBe('fatal');
    });

    it('classifies rate_limited: 429 / rate limit', () => {
        expect(classifyModelFailureMessage('429 Too Many Requests')).toBe('rate_limited');
        expect(classifyModelFailureMessage('rate limit exceeded')).toBe('rate_limited');
        expect(classifyModelFailureMessage('RateLimitError')).toBe('rate_limited');
        expect(classifyModelFailureMessage('quota exceeded')).toBe('rate_limited');
    });

    it('classifies bad_request: 400 / parameter', () => {
        expect(classifyModelFailureMessage('400 Bad Request')).toBe('bad_request');
        expect(classifyModelFailureMessage('invalid parameter')).toBe('bad_request');
        expect(classifyModelFailureMessage('validation error')).toBe('bad_request');
        expect(classifyModelFailureMessage('format error')).toBe('bad_request');
    });

    it('classifies temp: network errors', () => {
        expect(classifyModelFailureMessage('Failed to fetch')).toBe('temp');
        expect(classifyModelFailureMessage('Load failed')).toBe('temp');
        expect(classifyModelFailureMessage('network error')).toBe('temp');
        expect(classifyModelFailureMessage('timed out')).toBe('temp');
        expect(classifyModelFailureMessage('abort')).toBe('temp');
        expect(classifyModelFailureMessage('502 Bad Gateway')).toBe('temp');
        expect(classifyModelFailureMessage('503 Service Unavailable')).toBe('temp');
        expect(classifyModelFailureMessage('server error')).toBe('temp');
    });

    it('classifies unknown messages as unknown', () => {
        expect(classifyModelFailureMessage('')).toBe('unknown');
        expect(classifyModelFailureMessage('some random error')).toBe('unknown');
        expect(classifyModelFailureMessage('undefined')).toBe('unknown');
    });

    it('handles non-string input gracefully', () => {
        expect(classifyModelFailureMessage(String(undefined))).toBe('unknown');
        expect(classifyModelFailureMessage(String(null))).toBe('unknown');
    });
});

// ── recordModelSuccess ──

describe('recordModelSuccess', () => {
    it('clears failStreak, circuits, cooldownMultiplier, errors for the realModel', () => {
        const entry = makeEntry({
            failStreakByModel: { 'gpt-4o': 3 },
            circuitsByModel: { 'gpt-4o': 9999999999999 },
            cooldownMultiplierByModel: { 'gpt-4o': 8 },
            lastErrorByRealModel: { 'gpt-4o': 'some error' },
            lastErrorKindByModel: { 'gpt-4o': 'temp' as ModelFailureKind },
        });
        recordModelSuccess(entry, 'gpt-4o');
        expect(entry.failStreakByModel).not.toHaveProperty('gpt-4o');
        expect(entry.circuitsByModel).not.toHaveProperty('gpt-4o');
        expect(entry.cooldownMultiplierByModel?.['gpt-4o']).toBe(1);
        expect(entry.lastErrorByRealModel).not.toHaveProperty('gpt-4o');
        expect(entry.lastErrorKindByModel).not.toHaveProperty('gpt-4o');
    });

    it('does not affect other models', () => {
        const entry = makeEntry({
            failStreakByModel: { 'gpt-4o': 3, 'gemini-pro': 1 },
            circuitsByModel: { 'gpt-4o': 9999999999999, 'gemini-pro': 9999999999999 },
        });
        recordModelSuccess(entry, 'gpt-4o');
        expect(entry.failStreakByModel).not.toHaveProperty('gpt-4o');
        expect(entry.failStreakByModel).toHaveProperty('gemini-pro');
        expect(entry.circuitsByModel).not.toHaveProperty('gpt-4o');
        expect(entry.circuitsByModel).toHaveProperty('gemini-pro');
    });
});

// ── recordModelFailure ──

describe('recordModelFailure', () => {
    it('fatal: immediately enters long cooldown, does not count failStreak', () => {
        const entry = makeEntry();
        const now = 1000000;
        const result = recordModelFailure(entry, 'gpt-4o', 'fatal', 'model not found', defaultOpts, now);
        expect(result).toBe(true);
        const until = entry.circuitsByModel?.['gpt-4o'] ?? 0;
        expect(until - now).toBeGreaterThanOrEqual(6 * 3600_000 - 100);
        expect(entry.failStreakByModel?.['gpt-4o']).toBeUndefined();
    });

    it('rate_limited: short cooldown, does not count failStreak', () => {
        const entry = makeEntry();
        const now = 1000000;
        const result = recordModelFailure(entry, 'gpt-4o', 'rate_limited', '429', defaultOpts, now);
        expect(result).toBe(true);
        const until = entry.circuitsByModel?.['gpt-4o'] ?? 0;
        expect(until - now).toBeGreaterThanOrEqual(30_000 - 100);
        expect(entry.failStreakByModel?.['gpt-4o']).toBeUndefined();
    });

    it('bad_request: no effect, returns false', () => {
        const entry = makeEntry();
        const result = recordModelFailure(entry, 'gpt-4o', 'bad_request', '400', defaultOpts);
        expect(result).toBe(false);
        expect(entry.failStreakByModel?.['gpt-4o']).toBeUndefined();
        expect(entry.circuitsByModel?.['gpt-4o']).toBeUndefined();
    });

    it('temp: accumulates failStreak, enters cooldown at threshold', () => {
        const entry = makeEntry();
        const now = 1000000;
        // 第一次失败：未达阈值
        const r1 = recordModelFailure(entry, 'gpt-4o', 'temp', 'timeout', defaultOpts, now);
        expect(r1).toBe(false);
        expect(entry.failStreakByModel?.['gpt-4o']).toBe(1);
        expect(entry.circuitsByModel?.['gpt-4o']).toBeUndefined();
        // 第二次失败：达阈值（threshold=2），进入冷却
        const r2 = recordModelFailure(entry, 'gpt-4o', 'temp', 'timeout', defaultOpts, now);
        expect(r2).toBe(true);
        const until = entry.circuitsByModel?.['gpt-4o'] ?? 0;
        expect(until - now).toBeGreaterThanOrEqual(300_000 - 100);
        // failStreak 在冷却后清零
        expect(entry.failStreakByModel?.['gpt-4o']).toBeUndefined();
    });

    it('temp: exponential backoff doubles cooldown on each cycle', () => {
        const entry = makeEntry();
        const now = 1000000;
        // 第一次冷却（2次失败触发）：multiplier = 1
        recordModelFailure(entry, 'gpt-4o', 'temp', 'timeout', defaultOpts, now);
        recordModelFailure(entry, 'gpt-4o', 'temp', 'timeout', defaultOpts, now);
        const cooldown1 = entry.circuitsByModel?.['gpt-4o'] ?? 0;
        expect(cooldown1 - now).toBeGreaterThanOrEqual(300_000 - 100);
        expect(entry.cooldownMultiplierByModel?.['gpt-4o']).toBe(2);
        // 让冷却过期
        const later = now + 3600_000;
        // 再次冷却周期：2次失败 → 冷却时间翻倍
        recordModelFailure(entry, 'gpt-4o', 'temp', 'timeout', defaultOpts, later);
        recordModelFailure(entry, 'gpt-4o', 'temp', 'timeout', defaultOpts, later);
        const cooldown2 = entry.circuitsByModel?.['gpt-4o'] ?? 0;
        expect(cooldown2 - later).toBeGreaterThanOrEqual(600_000 - 100);
        expect(entry.cooldownMultiplierByModel?.['gpt-4o']).toBe(4);
        // 第三次冷却：multiplier -> 8
        const later2 = later + 3600_000;
        recordModelFailure(entry, 'gpt-4o', 'temp', 'timeout', defaultOpts, later2);
        recordModelFailure(entry, 'gpt-4o', 'temp', 'timeout', defaultOpts, later2);
        const cooldown3 = entry.circuitsByModel?.['gpt-4o'] ?? 0;
        expect(cooldown3 - later2).toBeGreaterThanOrEqual(1_200_000 - 100);
        expect(entry.cooldownMultiplierByModel?.['gpt-4o']).toBe(8);
    });

    it('temp: cooldown multiplier capped at maxCooldownMultiplier', () => {
        const entry = makeEntry();
        const opts = { ...defaultOpts, maxCooldownMultiplier: 4 };
        const now = 1000000;
        // 打满到 cap
        for (let i = 0; i < 6; i++) {
            const later = now + i * 3600_000;
            recordModelFailure(entry, 'gpt-4o', 'temp', 'timeout', opts, later);
            recordModelFailure(entry, 'gpt-4o', 'temp', 'timeout', opts, later);
        }
        // 最后一次冷却 multiplier 不应超过 4
        expect(entry.cooldownMultiplierByModel?.['gpt-4o']).toBeLessThanOrEqual(4);
    });

    it('records lastErrorByRealModel and lastErrorKindByModel', () => {
        const entry = makeEntry();
        recordModelFailure(entry, 'gpt-4o', 'temp', 'timeout error', defaultOpts, 1000000);
        expect(entry.lastErrorByRealModel?.['gpt-4o']).toBe('timeout error');
        expect(entry.lastErrorKindByModel?.['gpt-4o']).toBe('temp');
    });

    it('does not affect other models', () => {
        const entry = makeEntry();
        const now = 1000000;
        recordModelFailure(entry, 'gpt-4o', 'temp', 'timeout', defaultOpts, now);
        recordModelFailure(entry, 'gpt-4o', 'temp', 'timeout', defaultOpts, now);
        // gemini-pro 不应受影响
        expect(entry.failStreakByModel).not.toHaveProperty('gemini-pro');
        expect(entry.circuitsByModel).not.toHaveProperty('gemini-pro');
    });
});

// ── isModelInCooldown / modelCooldownRemainingMs ──

describe('isModelInCooldown', () => {
    it('returns true when circuit is active', () => {
        const entry = makeEntry({ circuitsByModel: { 'gpt-4o': 2000 } });
        expect(isModelInCooldown(entry, 'gpt-4o', 1000)).toBe(true);
    });

    it('returns false when circuit has expired', () => {
        const entry = makeEntry({ circuitsByModel: { 'gpt-4o': 500 } });
        expect(isModelInCooldown(entry, 'gpt-4o', 1000)).toBe(false);
    });

    it('returns false when no circuit exists', () => {
        const entry = makeEntry();
        expect(isModelInCooldown(entry, 'gpt-4o', 1000)).toBe(false);
    });

    it('returns false for null/undefined entry', () => {
        expect(isModelInCooldown(null, 'gpt-4o')).toBe(false);
        expect(isModelInCooldown(undefined, 'gpt-4o')).toBe(false);
    });
});

describe('modelCooldownRemainingMs', () => {
    it('returns remaining time', () => {
        const entry = makeEntry({ circuitsByModel: { 'gpt-4o': 2000 } });
        expect(modelCooldownRemainingMs(entry, 'gpt-4o', 1000)).toBe(1000);
    });

    it('returns 0 when expired', () => {
        const entry = makeEntry({ circuitsByModel: { 'gpt-4o': 500 } });
        expect(modelCooldownRemainingMs(entry, 'gpt-4o', 1000)).toBe(0);
    });
});