import { describe, it, expect } from 'vitest';
import {
    candidateUnits,
    isModelCircuitOpen,
    recordFailure,
    recordSelection,
    recordSuccess,
    routeOnce,
    rpmWindow,
    summarizeUnavailable,
    unavailabilityReason,
} from '../src/domain/routing.js';
import { normalizeProvider, normalizeProviders, resetRoutingRuntimeState } from '../src/domain/provider.js';
import { keyUnits, unitId } from '../src/domain/model-catalog.js';
import type { Provider, RoutingUnit } from '../src/types.js';

function providerWithKeys(name: string, keys: Record<string, any>[]): Provider {
    return normalizeProvider({ name, endpoint: 'https://x/v1', keys });
}

function unitsOf(provider: Provider): RoutingUnit[] {
    return keyUnits([provider]);
}

describe('routing：候选过滤与 RPM', () => {
    it('排除 provider/key 被禁用的单元', () => {
        const p = providerWithKeys('P', [
            { label: 'A', fetchedModels: ['m'] },
            { label: 'B', fetchedModels: ['m'], enabled: false },
        ]);
        p.enabled = false;
        const p2 = providerWithKeys('P2', [
            { label: 'A', fetchedModels: ['m'] },
            { label: 'B', fetchedModels: ['m'], enabled: false },
        ]);
        expect(candidateUnits([p], 'm')).toHaveLength(0); // provider 禁用 → 全排除
        expect(candidateUnits([p2], 'm')).toHaveLength(1); // key 禁用 → 仅排除 B
    });

    it('rpm=1：第一次选路后该 key 限流，下一次排除', () => {
        const p = providerWithKeys('P', [{ label: 'A', fetchedModels: ['m'], rpm: 1 }]);
        const r1 = routeOnce([p], 'm', { now: 1000 });
        expect(r1.unit?.key.label).toBe('A');
        const r2 = routeOnce([p], 'm', { now: 2000 });
        expect(r2.unit).toBeNull();
        expect(r2.reasons.join()).toContain('rpm');
    });

    it('熔断的那次请求也计入 rpm（窗口独立于熔断）', () => {
        const p = providerWithKeys('P', [{ label: 'A', fetchedModels: ['m'], rpm: 1 }]);
        const unit = unitsOf(p)[0];
        recordSelection(unit, 1000);
        recordFailure(unit, 'm', 'fail', { threshold: 1, cooldownMs: 60000 }, 2000);
        // 熔断后窗口计数不变（那一次请求仍占额度）
        expect(rpmWindow(unit.key, 2000).count).toBe(1);
        expect(isModelCircuitOpen(unit.key, 'm', 3000)).toBe(true);
    });
});

describe('routing：熔断按（key × 模型）', () => {
    it('一个模型熔断后，同 key 的其他模型仍可选', () => {
        const p = providerWithKeys('P', [{ label: 'A', fetchedModels: ['m1', 'm2'] }]);
        const unit = unitsOf(p)[0];
        recordFailure(unit, 'm1', 'fail', { threshold: 1, cooldownMs: 60000 }, 1000);
        // m1 熔断
        expect(unavailabilityReason(unit, 'm1', 2000)).toBe('circuit');
        expect(candidateUnits([p], 'm1', 2000)).toHaveLength(0);
        // m2 照常可选
        expect(unavailabilityReason(unit, 'm2', 2000)).toBeNull();
        expect(candidateUnits([p], 'm2', 2000)).toHaveLength(1);
    });

    it('冷却结束自动恢复，且成功清零连续失败', () => {
        const p = providerWithKeys('P', [{ label: 'A', fetchedModels: ['m'] }]);
        const unit = unitsOf(p)[0];
        recordFailure(unit, 'm', 'fail', { threshold: 3, cooldownMs: 60000 }, 1000);
        recordFailure(unit, 'm', 'fail', { threshold: 3, cooldownMs: 60000 }, 1100);
        expect(isModelCircuitOpen(unit.key, 'm', 2000)).toBe(false); // 2 次未达阈值
        recordFailure(unit, 'm', 'fail', { threshold: 3, cooldownMs: 60000 }, 1200);
        expect(isModelCircuitOpen(unit.key, 'm', 1300)).toBe(true); // 第 3 次熔断
        expect(isModelCircuitOpen(unit.key, 'm', 62000)).toBe(false); // 冷却结束
        // 熔断后成功清零（熔断期内成功不常见，但语义为清除失败计数）
        recordSuccess(unit, 'm');
        expect(unit.key.failStreakByModel['m']).toBeUndefined();
    });

    it('summarizeUnavailable 汇总原因', () => {
        const p = providerWithKeys('P', [{ label: 'A', fetchedModels: ['m'], rpm: 1 }]);
        const unit = unitsOf(p)[0];
        recordSelection(unit, 1000);
        const reasons = summarizeUnavailable([p], 'm', 2000);
        expect(reasons.join()).toContain('rpm');
    });
});

describe('routing：sticky 绝对时间', () => {
    it('窗口内复用同一单元，到期重选（重置 until）', () => {
        const p = providerWithKeys('P', [
            { label: 'A', fetchedModels: ['m'] },
            { label: 'B', fetchedModels: ['m'] },
        ]);
        const r1 = routeOnce([p], 'm', { stickySeconds: 600, now: 1000 });
        expect(r1.nextLastPicked?.until).toBe(1000 + 600 * 1000);
        const r2 = routeOnce([p], 'm', { stickySeconds: 600, lastPicked: r1.nextLastPicked, now: 2000 });
        expect(unitId(r2.unit!)).toBe(unitId(r1.unit!));
        // 到期：until 重置为新窗口
        const r3 = routeOnce([p], 'm', { stickySeconds: 600, lastPicked: r1.nextLastPicked, now: 999999 });
        expect(r3.nextLastPicked?.until).toBe(999999 + 600 * 1000);
    });

    it('sticky 复用仅在候选仍可用时成立', () => {
        const p = providerWithKeys('P', [
            { label: 'A', fetchedModels: ['m'], rpm: 1 },
            { label: 'B', fetchedModels: ['m'] },
        ]);
        const r1 = routeOnce([p], 'm', { stickySeconds: 600, now: 1000 });
        // A 限流（rpm=1）后，即使 sticky 指向 A 也换 B
        const r2 = routeOnce([p], 'm', { stickySeconds: 600, lastPicked: r1.nextLastPicked, now: 2000 });
        expect(r2.unit).not.toBeNull();
    });
});
