import { describe, it, expect } from 'vitest';
import { resolveFallbackRoute } from '../src/routing/fallback.js';
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

/** 构造"逻辑模型 lm1 有一个可用 unit"的 vendor/group 组合。 */
function usableVendorGroup(): { vendors: Vendor[]; groups: Group[] } {
    const v = vendor({
        id: 'v1',
        endpoint: 'https://example.com/v1',
        enabled: true,
        weight: 1,
    });
    // vendor 必须通过 mapping 挂到 group entry 上才能被 routeGroupOnce 选中
    const e = entry({ id: 'k1', vendorId: 'v1', apiKey: 'sk-test-123', mappings: [mapping()] });
    const g = group({ id: 'g1', currentLogicalModelId: 'lm1', entries: [e] });
    return { vendors: [v], groups: [g] };
}

describe('resolveFallbackRoute：独立流兜底路由决策', () => {
    it('选中可用 unit（正常路径）', () => {
        const { vendors, groups } = usableVendorGroup();
        const result = resolveFallbackRoute({
            type: 'normal',
            routingEnabled: true,
            activeGroupId: 'g1',
            groups,
            vendors,
        });
        expect(result.skipReason).toBeNull();
        expect(result.unit).not.toBeNull();
        expect(result.unit!.vendor.name).toBe('TestVendor');
        expect(result.unit!.realModel).toBe('gpt-4o');
    });

    it('quiet/continue/impersonate 跳过', () => {
        const { vendors, groups } = usableVendorGroup();
        for (const type of ['quiet', 'continue', 'impersonate']) {
            const result = resolveFallbackRoute({ type, routingEnabled: true, activeGroupId: 'g1', groups, vendors });
            expect(result.unit).toBeNull();
            expect(result.skipReason).toBe('non-user type');
        }
    });

    it('路由未启用跳过', () => {
        const { vendors, groups } = usableVendorGroup();
        const result = resolveFallbackRoute({ type: 'normal', routingEnabled: false, activeGroupId: 'g1', groups, vendors });
        expect(result.unit).toBeNull();
        expect(result.skipReason).toBe('routing disabled');
    });

    it('无启用 group 跳过（activeGroupId 不存在且无兜底 group）', () => {
        const { vendors } = usableVendorGroup();
        const result = resolveFallbackRoute({
            type: 'normal',
            routingEnabled: true,
            activeGroupId: 'missing',
            groups: [],
            vendors,
        });
        expect(result.unit).toBeNull();
        expect(result.skipReason).toBe('no active/enabled group');
    });

    it('active group 禁用时跳过', () => {
        const { vendors } = usableVendorGroup();
        const groups = [group({ id: 'g1', enabled: false, currentLogicalModelId: 'lm1' })];
        const result = resolveFallbackRoute({ type: 'normal', routingEnabled: true, activeGroupId: 'g1', groups, vendors });
        expect(result.unit).toBeNull();
        expect(result.skipReason).toBe('no active/enabled group');
    });

    it('无逻辑模型跳过', () => {
        const { vendors } = usableVendorGroup();
        const groups = [group({ id: 'g1', enabled: true, currentLogicalModelId: '' })];
        const result = resolveFallbackRoute({ type: 'normal', routingEnabled: true, activeGroupId: 'g1', groups, vendors });
        expect(result.unit).toBeNull();
        expect(result.skipReason).toBe('no logical model');
    });

    it('vendor 全禁用 → 无路由单元', () => {
        const { groups } = usableVendorGroup();
        const vendors = [vendor({ id: 'v1', enabled: false })];
        const result = resolveFallbackRoute({ type: 'normal', routingEnabled: true, activeGroupId: 'g1', groups, vendors });
        expect(result.unit).toBeNull();
        expect(result.skipReason).toContain('no route unit');
    });

    it('无 activeGroupId 时兜底到第一个 group', () => {
        const { vendors, groups } = usableVendorGroup();
        const result = resolveFallbackRoute({ type: 'normal', routingEnabled: true, activeGroupId: null, groups, vendors });
        expect(result.unit).not.toBeNull();
        expect(result.skipReason).toBeNull();
    });

    it('logicalModelId 覆盖优先于 group.currentLogicalModelId', () => {
        const { vendors, groups } = usableVendorGroup();
        // group 指向 lm1，但显式传 lm2（不存在 mapping）→ 无路由单元
        const result = resolveFallbackRoute({
            type: 'normal',
            routingEnabled: true,
            activeGroupId: 'g1',
            groups,
            vendors,
            logicalModelId: 'lm2',
        });
        expect(result.unit).toBeNull();
        expect(result.skipReason).toContain('no route unit');
    });
});
