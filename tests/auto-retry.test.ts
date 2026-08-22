import { describe, it, expect } from 'vitest';
import {
    autoRetryDelayMs,
    evaluateAutoRetry,
    routeGroupOnce,
    classifyRetryChainStart,
    groupUnitKey,
    type GroupRouteUnit,
} from '../src/domain/group-routing.js';
import { normalizeRoutingSettings } from '../src/constants.js';
import type { Group, GroupEntry, Vendor } from '../src/types.js';

function makeVendor(id: string, name: string): Vendor {
    return {
        id,
        name,
        format: 'custom',
        endpoint: 'https://example.com/v1',
        rpm: 0,
        maxContext: 0,
        maxInputTokens: 0,
        maxOutputTokens: 0,
        weight: 1,
        enabled: true,
        disabledReason: '',
        window: [],
        failStreak: 0,
        successes: 0,
        failures: 0,
        lastError: '',
        updatedAt: '',
    };
}

function makeEntry(id: string, vendorId: string, realModel: string): GroupEntry {
    return {
        id,
        vendorId,
        apiKey: `sk-${id}`,
        label: `Key ${id}`,
        enabled: true,
        weight: 1,
        fetchedModels: [realModel],
        mappings: [{ id: `m-${id}`, realModel, logicalModelId: 'lm1', weight: 1 }],
    };
}

function makeGroup(entries: GroupEntry[]): Group {
    return { id: 'g1', name: '测试分组', enabled: true, currentLogicalModelId: 'lm1', entries };
}

const baseRetryOpts = {
    autoRetryCount: 3,
    retriesUsed: 0,
    routingEnabled: true,
    extensionDisabled: false,
    presetTransitionBlocked: false,
    groupIntact: true,
};

describe('evaluateAutoRetry', () => {
    it('returns canRetry=false when autoRetryCount is 0', () => {
        expect(evaluateAutoRetry({ ...baseRetryOpts, autoRetryCount: 0 }).canRetry).toBe(false);
    });

    it('allows retry while retriesUsed below the cap and numbers attempts from 1', () => {
        const first = evaluateAutoRetry({ ...baseRetryOpts, retriesUsed: 0 });
        expect(first).toEqual({ canRetry: true, attempt: 1 });
        const third = evaluateAutoRetry({ ...baseRetryOpts, retriesUsed: 2 });
        expect(third).toEqual({ canRetry: true, attempt: 3 });
    });

    it('stops when retriesUsed reaches the cap', () => {
        const decision = evaluateAutoRetry({ ...baseRetryOpts, retriesUsed: 3 });
        expect(decision.canRetry).toBe(false);
        expect(decision.attempt).toBe(4);
    });

    it.each([
        ['routing disabled', { routingEnabled: false }],
        ['extension disabled', { extensionDisabled: true }],
        ['preset transition', { presetTransitionBlocked: true }],
        ['group changed', { groupIntact: false }],
    ] as const)('blocks retry when %s', (_label, overrides) => {
        expect(evaluateAutoRetry({ ...baseRetryOpts, ...overrides }).canRetry).toBe(false);
    });
});

describe('routeGroupOnce excludeKeys', () => {
    it('picks the remaining candidate when the failed unit is excluded', () => {
        const vendor = makeVendor('v1', 'V1');
        const group = makeGroup([makeEntry('e1', 'v1', 'gpt-4o'), makeEntry('e2', 'v1', 'gpt-4o-mini')]);
        const result = routeGroupOnce([vendor], group, 'lm1', { excludeKeys: ['v1::e1::m-e1'] });
        expect(result.unit).not.toBeNull();
        expect(groupUnitKey(result.unit!)).toBe('v1::e2::m-e2');
    });

    it('returns null with exclusion reason when all candidates are excluded', () => {
        const vendor = makeVendor('v1', 'V1');
        const group = makeGroup([makeEntry('e1', 'v1', 'gpt-4o')]);
        const result = routeGroupOnce([vendor], group, 'lm1', { excludeKeys: ['v1::e1::m-e1'] });
        expect(result.unit).toBeNull();
        expect(result.reasons.join('；')).toContain('已排除');
    });

    it('does not filter when excludeKeys is empty', () => {
        const vendor = makeVendor('v1', 'V1');
        const group = makeGroup([makeEntry('e1', 'v1', 'gpt-4o'), makeEntry('e2', 'v1', 'gpt-4o-mini')]);
        const result = routeGroupOnce([vendor], group, 'lm1');
        expect(result.unit).not.toBeNull();
        expect(result.reasons).toEqual([]);
    });

    it('excludes by mapping identity, not only entry', () => {
        const vendor = makeVendor('v1', 'V1');
        const group = makeGroup([makeEntry('e1', 'v1', 'gpt-4o')]);
        // 排除的是另一个映射 id，不应误伤
        const result = routeGroupOnce([vendor], group, 'lm1', { excludeKeys: ['v1::e1::other'] });
        expect(result.unit).not.toBeNull();
    });
});

describe('autoRetryDelayMs', () => {
    it('returns base when randomValue is 0', () => {
        expect(autoRetryDelayMs(1200, 500, 0)).toBe(1200);
    });

    it('stays strictly below base + jitter for randomValue < 1', () => {
        expect(autoRetryDelayMs(1200, 500, 0.9999)).toBe(1699);
    });

    it('ignores negative base/jitter and clamps randomValue', () => {
        expect(autoRetryDelayMs(-10, 500, 0.5)).toBe(250);
        expect(autoRetryDelayMs(1200, 0, 0.5)).toBe(1200);
        expect(autoRetryDelayMs(1200, 500, 2)).toBe(1700);
    });
});

describe('classifyRetryChainStart', () => {
    const base = { retryScheduled: true, type: 'normal' as string | undefined, scheduledAt: 1000, now: 2500, windowMs: 15000, automaticTrigger: true, scheduledType: 'regenerate' };

    it('self: our own scheduled regenerate within the window', () => {
        expect(classifyRetryChainStart({ ...base, type: 'regenerate', automaticTrigger: false })).toBe('self');
    });

    it('self: our own scheduled swipe retry comes back as swipe', () => {
        expect(classifyRetryChainStart({ ...base, type: 'swipe', scheduledType: 'swipe', automaticTrigger: false })).toBe('self');
    });

    it('inherit: automatic generation within the window takes over the chain', () => {
        expect(classifyRetryChainStart(base)).toBe('inherit');
    });

    it('fresh: manual generation within the window resets the chain', () => {
        expect(classifyRetryChainStart({ ...base, automaticTrigger: false })).toBe('fresh');
    });

    it('fresh: nothing was scheduled', () => {
        expect(classifyRetryChainStart({ ...base, retryScheduled: false })).toBe('fresh');
    });

    it('fresh: stale schedule beyond the window even for automatic or regenerate starts', () => {
        expect(classifyRetryChainStart({ ...base, now: 16001 })).toBe('fresh');
        expect(classifyRetryChainStart({ ...base, type: 'regenerate', now: 16001 })).toBe('fresh');
    });
});

describe('normalizeRoutingSettings autoRetryCount', () => {
    it('defaults to 0 when missing', () => {
        expect(normalizeRoutingSettings({}).autoRetryCount).toBe(0);
    });

    it('clamps to non-negative integers', () => {
        expect(normalizeRoutingSettings({ autoRetryCount: 5 }).autoRetryCount).toBe(5);
        expect(normalizeRoutingSettings({ autoRetryCount: -1 }).autoRetryCount).toBe(0);
        expect(normalizeRoutingSettings({ autoRetryCount: 'abc' }).autoRetryCount).toBe(0);
        expect(normalizeRoutingSettings({ autoRetryCount: 2.9 }).autoRetryCount).toBe(2);
    });
});

describe('normalizeRoutingSettings autoRetryDelayMs', () => {
    it('defaults to 1200 when missing', () => {
        expect(normalizeRoutingSettings({}).autoRetryDelayMs).toBe(1200);
    });

    it('clamps to non-negative integers', () => {
        expect(normalizeRoutingSettings({ autoRetryDelayMs: 2500 }).autoRetryDelayMs).toBe(2500);
        expect(normalizeRoutingSettings({ autoRetryDelayMs: -1 }).autoRetryDelayMs).toBe(1200);
        expect(normalizeRoutingSettings({ autoRetryDelayMs: 'abc' }).autoRetryDelayMs).toBe(1200);
        expect(normalizeRoutingSettings({ autoRetryDelayMs: 1.9 }).autoRetryDelayMs).toBe(1);
    });
});
