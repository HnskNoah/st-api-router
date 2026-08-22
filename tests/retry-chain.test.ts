import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// 桩模块必须先于被测模块求值（见文件头注释）。
import './helpers/browser-globals.js';
import { createRetryChain } from '../src/routing/retry-chain.js';
import { classifyRetryChainStart } from '../src/domain/group-routing.js';
import { runtimeState } from '../src/state.js';
import type { Group, GroupEntry, RoutingSettings, Vendor } from '../src/types.js';
import type { GroupRouteUnit } from '../src/domain/group-routing.js';

function makeRouting(autoRetryDelayMs: number): RoutingSettings {
    return { enabled: true, stickyCount: 0, failThreshold: 3, cooldownSeconds: 300, autoRetryCount: 5, autoRetryDelayMs };
}

function makeUnit(): GroupRouteUnit {
    const vendor: Vendor = {
        id: 'v1',
        name: 'V1',
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
    const entry: GroupEntry = {
        id: 'e1',
        vendorId: 'v1',
        apiKey: 'sk-e1',
        label: 'Key e1',
        enabled: true,
        weight: 1,
        fetchedModels: ['gpt-4o'],
        mappings: [{ id: 'm-e1', realModel: 'gpt-4o', logicalModelId: 'lm1', weight: 1 }],
    };
    return { vendor, entry, realModel: 'gpt-4o', mapping: entry.mappings[0] };
}

function makeGroup(): Group {
    return { id: 'g1', name: '测试分组', enabled: true, currentLogicalModelId: 'lm1', entries: [makeUnit().entry] };
}

describe('retry chain consumption window', () => {
    beforeEach(() => {
        runtimeState.extensionDisabled = false;
        runtimeState.presetTransitionBlocked = false;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('claims its own regenerate when the configured delay exceeds the legacy 15s window', () => {
        const group = makeGroup();
        const chain = createRetryChain({
            getRouting: () => makeRouting(20_000),
            getGroups: () => [group],
            getActiveGroupId: () => 'g1',
            isUserStopPending: () => false,
            prepareSwipeRetryTarget: () => {},
        });
        const unit = makeUnit();

        vi.useFakeTimers();
        const t0 = 1_000_000;
        vi.setSystemTime(t0);
        chain.handleFailure({ unit, logicalModelId: 'lm1', emptyResponse: false, originType: 'regenerate' });

        // 定时器在 延迟20s + 抖动≤500ms 后触发；重试生成到场时距排定已 ~20s
        vi.setSystemTime(t0 + 20_500);
        expect(chain.consumeStart('regenerate', false)).toBe('self');
    });

    it('keeps expiry semantics for the default short delay beyond the floor window', () => {
        const group = makeGroup();
        const chain = createRetryChain({
            getRouting: () => makeRouting(1_200),
            getGroups: () => [group],
            getActiveGroupId: () => 'g1',
            isUserStopPending: () => false,
            prepareSwipeRetryTarget: () => {},
        });
        const unit = makeUnit();

        vi.useFakeTimers();
        const t0 = 2_000_000;
        vi.setSystemTime(t0);
        chain.handleFailure({ unit, logicalModelId: 'lm1', emptyResponse: false, originType: 'regenerate' });

        // 默认延迟下 15s 下限仍生效：远超窗口的到场视为过期
        vi.setSystemTime(t0 + 16_001);
        expect(chain.consumeStart('regenerate', false)).toBe('fresh');
    });

    it('classifier keeps matching scheduled type for self claims', () => {
        expect(classifyRetryChainStart({
            retryScheduled: true,
            type: 'swipe',
            scheduledAt: 0,
            now: 5_000,
            windowMs: 15_000,
            automaticTrigger: false,
            scheduledType: 'swipe',
        })).toBe('self');
    });
});
