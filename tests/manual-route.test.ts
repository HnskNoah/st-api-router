import { describe, it, expect } from 'vitest';
import { resolveManualRouteOutcome } from '../src/routing/manual-route.js';
import type { Group, GroupEntry, Vendor, VendorModelMapping } from '../src/types.js';

function vendor(overrides: Partial<Vendor> = {}): Vendor {
    return {
        id: 'v1',
        name: 'TestVendor',
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
        ...overrides,
    };
}

function entry(overrides: Partial<GroupEntry> = {}): GroupEntry {
    return {
        id: 'k1',
        vendorId: 'v1',
        apiKey: 'sk-test-123',
        label: 'A',
        enabled: true,
        fetchedModels: [],
        mappings: [],
        ...overrides,
    };
}

function mapping(overrides: Partial<VendorModelMapping> = {}): VendorModelMapping {
    return { id: 'm1', realModel: 'gpt-4o', logicalModelId: 'lm1', ...overrides };
}

function group(overrides: Partial<Group> = {}): Group {
    return {
        id: 'g1',
        name: 'G',
        enabled: true,
        currentLogicalModelId: 'lm1',
        entries: [],
        ...overrides,
    };
}

function usableVendorGroup(): { vendors: Vendor[]; groups: Group[] } {
    const v = vendor({ id: 'v1', endpoint: 'https://example.com/v1', enabled: true, weight: 1 });
    const e = entry({ id: 'k1', vendorId: 'v1', apiKey: 'sk-test-123', mappings: [mapping()] });
    const g = group({ id: 'g1', currentLogicalModelId: 'lm1', entries: [e] });
    return { vendors: [v], groups: [g] };
}

describe('resolveManualRouteOutcome：手动路由决策', () => {
    it('选中可用 unit（正常路径）', () => {
        const { vendors, groups } = usableVendorGroup();
        const outcome = resolveManualRouteOutcome({
            routingEnabled: true,
            activeGroupId: 'g1',
            groups,
            vendors,
        });
        expect(outcome.unit).not.toBeNull();
        expect(outcome.toastrType).toBe('info');
        expect(outcome.toastrText).toContain('TestVendor');
        expect(outcome.toastrText).toContain('gpt-4o');
    });

    it('路由未启用 → warning', () => {
        const { vendors, groups } = usableVendorGroup();
        const outcome = resolveManualRouteOutcome({ routingEnabled: false, activeGroupId: 'g1', groups, vendors });
        expect(outcome.unit).toBeNull();
        expect(outcome.toastrType).toBe('warning');
        expect(outcome.toastrText).toContain('路由未启用');
    });

    it('无启用分组 → warning', () => {
        const { vendors } = usableVendorGroup();
        const outcome = resolveManualRouteOutcome({ routingEnabled: true, activeGroupId: 'missing', groups: [], vendors });
        expect(outcome.unit).toBeNull();
        expect(outcome.toastrType).toBe('warning');
        expect(outcome.toastrText).toContain('没有启用的分组');
    });

    it('未选择逻辑模型 → warning', () => {
        const { vendors } = usableVendorGroup();
        const groups = [group({ id: 'g1', enabled: true, currentLogicalModelId: '' })];
        const outcome = resolveManualRouteOutcome({ routingEnabled: true, activeGroupId: 'g1', groups, vendors });
        expect(outcome.unit).toBeNull();
        expect(outcome.toastrType).toBe('warning');
        expect(outcome.toastrText).toContain('尚未选择逻辑模型');
    });

    it('无可用 Vendor → warning 且带原因', () => {
        const { groups } = usableVendorGroup();
        const vendors = [vendor({ id: 'v1', enabled: false })];
        const outcome = resolveManualRouteOutcome({ routingEnabled: true, activeGroupId: 'g1', groups, vendors });
        expect(outcome.unit).toBeNull();
        expect(outcome.toastrType).toBe('warning');
        expect(outcome.toastrText).toContain('手动路由失败');
    });
});