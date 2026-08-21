import { describe, it, expect } from 'vitest';
import { resolveManualLock, isManualLockApplicable } from '../src/routing/manual-route.js';
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

describe('resolveManualLock：手动锁定下一次模型（只读选路）', () => {
    it('选中可用 unit 且不记录 RPM', () => {
        const { vendors, groups } = usableVendorGroup();
        const result = resolveManualLock({
            routingEnabled: true,
            activeGroupId: 'g1',
            groups,
            vendors,
        });
        expect(result.skipReason).toBeNull();
        expect(result.unit).not.toBeNull();
        expect(result.unit!.vendor.name).toBe('TestVendor');
        expect(result.unit!.realModel).toBe('gpt-4o');
        // 只读选路：不得消耗 RPM 窗口
        expect(vendors[0].window.length).toBe(0);
    });

    it('路由未启用 → skipReason=routing disabled', () => {
        const { vendors, groups } = usableVendorGroup();
        const result = resolveManualLock({ routingEnabled: false, activeGroupId: 'g1', groups, vendors });
        expect(result.unit).toBeNull();
        expect(result.skipReason).toBe('routing disabled');
    });

    it('无启用分组 → skipReason=no active/enabled group', () => {
        const { vendors } = usableVendorGroup();
        const result = resolveManualLock({ routingEnabled: true, activeGroupId: 'missing', groups: [], vendors });
        expect(result.unit).toBeNull();
        expect(result.skipReason).toBe('no active/enabled group');
    });

    it('未选择逻辑模型 → skipReason=no logical model', () => {
        const { vendors } = usableVendorGroup();
        const groups = [group({ id: 'g1', enabled: true, currentLogicalModelId: '' })];
        const result = resolveManualLock({ routingEnabled: true, activeGroupId: 'g1', groups, vendors });
        expect(result.unit).toBeNull();
        expect(result.skipReason).toBe('no logical model');
    });

    it('无可用 Vendor → skipReason=no route unit', () => {
        const { groups } = usableVendorGroup();
        const vendors = [vendor({ id: 'v1', enabled: false })];
        const result = resolveManualLock({ routingEnabled: true, activeGroupId: 'g1', groups, vendors });
        expect(result.unit).toBeNull();
        expect(result.skipReason).toBe('no route unit');
    });
});

describe('isManualLockApplicable：锁定是否仍适用于当前上下文', () => {
    it('属于当前分组且逻辑模型匹配且可用 → true', () => {
        const { vendors, groups } = usableVendorGroup();
        const unit = resolveManualLock({ routingEnabled: true, activeGroupId: 'g1', groups, vendors }).unit!;
        expect(isManualLockApplicable(unit, groups[0], 'lm1')).toBe(true);
    });

    it('group 为 null → false', () => {
        const { vendors, groups } = usableVendorGroup();
        const unit = resolveManualLock({ routingEnabled: true, activeGroupId: 'g1', groups, vendors }).unit!;
        expect(isManualLockApplicable(unit, null, 'lm1')).toBe(false);
    });

    it('逻辑模型不匹配 → false', () => {
        const { vendors, groups } = usableVendorGroup();
        const unit = resolveManualLock({ routingEnabled: true, activeGroupId: 'g1', groups, vendors }).unit!;
        expect(isManualLockApplicable(unit, groups[0], 'lm2')).toBe(false);
    });

    it('entry 不属于当前分组 → false', () => {
        const { vendors } = usableVendorGroup();
        const v = vendor({ id: 'v1', enabled: true });
        const e = entry({ id: 'k1', vendorId: 'v1', apiKey: 'sk-123', mappings: [mapping()] });
        const lockedUnit = { vendor: v, entry: e, mapping: mapping(), realModel: 'gpt-4o' };
        const otherGroup = group({ id: 'g1', currentLogicalModelId: 'lm1', entries: [] });
        expect(isManualLockApplicable(lockedUnit, otherGroup, 'lm1')).toBe(false);
    });

    it('vendor 被禁用 → false', () => {
        const { groups } = usableVendorGroup();
        const v = vendor({ id: 'v1', enabled: false });
        const e = entry({ id: 'k1', vendorId: 'v1', apiKey: 'sk-123', mappings: [mapping()] });
        const lockedUnit = { vendor: v, entry: e, mapping: mapping(), realModel: 'gpt-4o' };
        expect(isManualLockApplicable(lockedUnit, groups[0], 'lm1')).toBe(false);
    });
    it('mapping removed from current entry invalidates the lock', () => {
        const { vendors, groups } = usableVendorGroup();
        const unit = resolveManualLock({ routingEnabled: true, activeGroupId: 'g1', groups, vendors }).unit!;
        groups[0].entries[0].mappings = [];
        expect(isManualLockApplicable(unit, groups[0], 'lm1')).toBe(false);
    });

    it('mapping rebound to another logical model invalidates the lock', () => {
        const { vendors, groups } = usableVendorGroup();
        const unit = resolveManualLock({ routingEnabled: true, activeGroupId: 'g1', groups, vendors }).unit!;
        groups[0].entries[0].mappings[0].logicalModelId = 'lm2';
        expect(isManualLockApplicable(unit, groups[0], 'lm1')).toBe(false);
    });
});