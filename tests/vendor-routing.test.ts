import { describe, it, expect } from 'vitest';
import { normalizeProviders } from '../src/domain/provider.js';
import {
    migrateProvidersToVendorModel,
    normalizeGroup,
    normalizeGroups,
    normalizeLogicalModels,
    normalizeVendor,
    normalizeVendors,
    recordVendorFailure,
    recordVendorSuccess,
    resetVendorRuntimeState,
    vendorEffectiveWeight,
} from '../src/domain/vendor.js';
import {
    candidateGroupUnits,
    groupUnitsForLogicalModel,
    routeGroupOnce,
    summarizeGroupUnavailable,
    vendorRpmAvailable,
} from '../src/domain/group-routing.js';
import type { Vendor } from '../src/types.js';

describe('domain/vendor normalization', () => {
    it('normalizeVendor fills defaults and caps', () => {
        const vendor = normalizeVendor({ name: ' V ', endpoint: 'x'.repeat(3000), rpm: -1, maxContext: 12.9, weight: 0, enabled: false, disabledReason: 'd'.repeat(600) });
        expect(vendor.name).toBe('V');
        expect(vendor.endpoint).toHaveLength(2048);
        expect(vendor.rpm).toBe(3);
        expect(vendor.maxContext).toBe(12);
        expect(vendor.weight).toBe(1);
        expect(vendor.enabled).toBe(false);
        expect(vendor.disabledReason).toHaveLength(500);
        expect(vendor.id.startsWith('vendor-')).toBe(true);
    });

    it('normalizeLogicalModels and normalizeGroups normalize arrays', () => {
        expect(normalizeLogicalModels([{ id: ' l1 ', name: '  Grok ' }])).toEqual([{ id: 'l1', name: 'Grok' }]);
        const groups = normalizeGroups([{ id: 'g1', name: ' 主 ', currentLogicalModelId: 'l1', entries: [{ vendorId: 'v1', apiKey: ' k ', label: 'A' }] }]);
        expect(groups[0].name).toBe('主');
        expect(groups[0].entries[0].apiKey).toBe('k');
        expect(normalizeGroup(undefined).id.startsWith('group-')).toBe(true);
    });
});

describe('domain/vendor migration', () => {
    it('migrates old Provider/Key into Vendor + LogicalModel + Group', () => {
        const migrated = migrateProvidersToVendorModel(normalizeProviders([
            {
                name: 'A',
                endpoint: 'https://a/v1',
                keys: [{ label: 'A1', fetchedModels: ['grok', 'gemini'] }, { label: 'A2', fetchedModels: ['grok'] }],
            },
        ]));
        expect(migrated.vendors).toHaveLength(1);
        expect(migrated.vendors[0].fetchedModels).toEqual(['grok', 'gemini']);
        expect(migrated.vendors[0].mappings).toHaveLength(2);
        expect(migrated.logicalModels.map(model => model.name)).toEqual(['grok', 'gemini']);
        expect(migrated.groups).toHaveLength(1);
        expect(migrated.groups[0].entries).toHaveLength(2);
        expect(migrated.groups[0].currentLogicalModelId).toBe(migrated.logicalModels[0].id);
    });

    it('does not create empty group when no keys', () => {
        const migrated = migrateProvidersToVendorModel([]);
        expect(migrated.vendors).toEqual([]);
        expect(migrated.groups).toEqual([]);
    });
});

describe('domain/vendor health and success weight', () => {
    it('success clears failStreak, failure auto disables at threshold', () => {
        const vendor = normalizeVendor({});
        expect(recordVendorFailure(vendor, 'err', 3)).toBe(false);
        expect(recordVendorFailure(vendor, 'err', 3)).toBe(false);
        expect(vendor.failStreak).toBe(2);
        expect(vendor.enabled).toBe(true);
        expect(recordVendorFailure(vendor, 'err', 3)).toBe(true);
        expect(vendor.enabled).toBe(false);
        expect(vendor.disabledReason).toContain('自动禁用');
        recordVendorSuccess(vendor);
        expect(vendor.failStreak).toBe(0);
        expect(vendor.successes).toBe(1);
        expect(vendor.failures).toBe(3);
    });

    it('effective weight favors successful vendors', () => {
        const good = normalizeVendor({ weight: 1, successes: 9, failures: 1 });
        const bad = normalizeVendor({ weight: 1, successes: 1, failures: 9 });
        expect(vendorEffectiveWeight(good)).toBeGreaterThan(vendorEffectiveWeight(bad));
        expect(vendorEffectiveWeight(normalizeVendor({}))).toBe(1);
    });

    it('reset runtime clears window and fail streak but keeps stats', () => {
        const vendor = normalizeVendor({ window: [1], failStreak: 2, successes: 3, failures: 4 });
        resetVendorRuntimeState([vendor]);
        expect(vendor.window).toEqual([]);
        expect(vendor.failStreak).toBe(0);
        expect(vendor.successes).toBe(3);
        expect(vendor.failures).toBe(4);
    });
});

describe('domain/group-routing', () => {
    it('finds entries carrying logical model within the same migration graph', () => {
        const migrated = migrateProvidersToVendorModel(normalizeProviders([
            {
                name: 'A',
                endpoint: 'https://a/v1',
                keys: [{ label: 'A1', fetchedModels: ['[希希2]grok-4.5'] }, { label: 'A2', fetchedModels: ['[希希2]grok-4.5'] }],
            },
        ]));
        const group = migrated.groups[0];
        const units = groupUnitsForLogicalModel(migrated.vendors, group, group.currentLogicalModelId);
        expect(units.length).toBe(2);
        expect(units[0].realModel).toBe('[希希2]grok-4.5');
    });

    it('vendor rpm is shared across entries in same group', () => {
        const migrated = migrateProvidersToVendorModel(normalizeProviders([
            {
                name: 'A',
                endpoint: 'https://a/v1',
                keys: [
                    { label: 'A1', fetchedModels: ['m'], rpm: 1 },
                    { label: 'A2', fetchedModels: ['m'], rpm: 1 },
                ],
            },
        ]));
        migrated.vendors[0].rpm = 1;
        const group = migrated.groups[0];
        const r1 = routeGroupOnce(migrated.vendors, group, group.currentLogicalModelId, { now: 1000 });
        expect(r1.unit).not.toBeNull();
        expect(r1.unit!.vendor.window).toEqual([1000]);
        const r2 = routeGroupOnce(migrated.vendors, group, group.currentLogicalModelId, { now: 2000 });
        expect(r2.unit).toBeNull();
        expect(r2.reasons.join()).toContain('rpm');
    });

    it('excludes disabled vendor and disabled entry', () => {
        const migrated = migrateProvidersToVendorModel(normalizeProviders([
            {
                name: 'A',
                endpoint: 'https://a/v1',
                keys: [{ label: 'A1', fetchedModels: ['m'] }, { label: 'A2', fetchedModels: ['m'] }],
            },
        ]));
        const group = migrated.groups[0];
        migrated.vendors[0].enabled = false;
        expect(candidateGroupUnits(migrated.vendors, group, group.currentLogicalModelId)).toHaveLength(0);
        migrated.vendors[0].enabled = true;
        group.entries[0].enabled = false;
        expect(candidateGroupUnits(migrated.vendors, group, group.currentLogicalModelId)).toHaveLength(1);
    });

    it('summarize unavailable lists disabled vendor reasons', () => {
        const migrated = migrateProvidersToVendorModel(normalizeProviders([
            { name: 'A', endpoint: 'https://a/v1', keys: [{ label: 'A1', fetchedModels: ['m'] }] },
        ]));
        const group = migrated.groups[0];
        migrated.vendors[0].enabled = false;
        expect(summarizeGroupUnavailable(migrated.vendors, group, group.currentLogicalModelId).join()).toContain('disabled');
    });

    it('route picks one of available candidates and records vendor rpm', () => {
        const migrated = migrateProvidersToVendorModel(normalizeProviders([
            {
                name: 'A',
                endpoint: 'https://a/v1',
                keys: [{ label: 'A1', fetchedModels: ['m'], rpm: 1 }, { label: 'A2', fetchedModels: ['m'], rpm: 1 }],
            },
            { name: 'B', endpoint: 'https://b/v1', keys: [{ label: 'B1', fetchedModels: ['m'], rpm: 1 }] },
        ]));
        const group = migrated.groups[0];
        const result = routeGroupOnce(migrated.vendors, group, group.currentLogicalModelId, { now: 1000 });
        expect(result.unit).not.toBeNull();
        // A/B 同权重候选，随机选路选到哪个都合法
        expect(['A', 'B']).toContain(result.unit!.vendor.name);
        // 被选中 Vendor 的 window 记录了本次选路时间
        expect(result.unit!.vendor.window).toEqual([1000]);
        expect(vendorRpmAvailable(result.unit!.vendor, 2000)).toBe(false);
        // 未选中的 Vendor 不受影响
        const other = migrated.vendors.find(vendor => vendor.id !== result.unit!.vendor.id)!;
        expect(other.window).toEqual([]);
        expect(vendorRpmAvailable(other, 2000)).toBe(true);
    });

    it('no candidates returns clear reasons instead of crashing', () => {
        const vendors = normalizeVendors([]);
        const group = normalizeGroup({ currentLogicalModelId: 'missing', entries: [{ vendorId: 'v', apiKey: 'k' }] });
        const result = routeGroupOnce(vendors, group, 'missing');
        expect(result.unit).toBeNull();
        expect(result.reasons.length).toBeGreaterThan(0);
    });

    it('same logical model can be served by multiple vendors', () => {
        // 在同一个迁移图里：两个 Vendor 都提供同一个真实模型名，归并到同一个逻辑模型
        const migrated = migrateProvidersToVendorModel(normalizeProviders([
            {
                name: 'X',
                endpoint: 'https://x/v1',
                keys: [{ label: 'K1', fetchedModels: ['grok-4.5'] }],
            },
            {
                name: 'Y',
                endpoint: 'https://y/v1',
                keys: [{ label: 'K2', fetchedModels: ['grok-4.5'] }],
            },
        ]));
        const group = migrated.groups[0];
        expect(group.entries).toHaveLength(2);
        const units = groupUnitsForLogicalModel(migrated.vendors, group, group.currentLogicalModelId);
        expect(units.length).toBe(2);
        expect(new Set(units.map(unit => unit.vendor.name))).toEqual(new Set(['X', 'Y']));
        expect(migrated.vendors[0].id).not.toBe(migrated.vendors[1].id);
        for (const unit of units) expect(unit.realModel).toBe('grok-4.5');
    });
});
