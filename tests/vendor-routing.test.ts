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
import type { Group, Vendor } from '../src/types.js';

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
        expect(normalizeLogicalModels([{ id: ' l1 ', name: '  Grok ' }])).toEqual([{ id: 'l1', name: 'Grok', matchPattern: '' }]);
        const groups = normalizeGroups([{ id: 'g1', name: ' 主 ', currentLogicalModelId: 'l1', entries: [{ vendorId: 'v1', apiKey: ' k ', label: 'A' }] }]);
        expect(groups[0].name).toBe('主');
        expect(groups[0].entries[0].apiKey).toBe('k');
        expect(normalizeGroup(undefined).id.startsWith('group-')).toBe(true);
    });

    it('GroupEntry keeps its own fetchedModels and mappings (model data is per Key)', () => {
        const groups = normalizeGroups([{
            id: 'g1',
            entries: [{
                vendorId: 'v1',
                apiKey: 'k',
                label: 'A',
                fetchedModels: ['[1]claude-opus-4-8', '  ', 'gemini-3.1-pro-preview'],
                mappings: [{ id: 'm1', realModel: '[1]claude-opus-4-8', logicalModelId: 'l1' }],
            }],
        }]);
        expect(groups[0].entries[0].fetchedModels).toEqual(['[1]claude-opus-4-8', 'gemini-3.1-pro-preview']);
        expect(groups[0].entries[0].mappings).toEqual([{ id: 'm1', realModel: '[1]claude-opus-4-8', logicalModelId: 'l1' }]);
    });
});

describe('domain/vendor migration', () => {
    it('migrates old Provider/Key into Vendor + Group structure, old model data is discarded', () => {
        const migrated = migrateProvidersToVendorModel(normalizeProviders([
            {
                name: 'A',
                endpoint: 'https://a/v1',
                keys: [
                    { label: 'A1', fetchedModels: ['grok', 'gemini'] },
                    { label: 'A2', fetchedModels: ['grok'] },
                ],
            },
        ]));
        expect(migrated.vendors).toHaveLength(1);
        expect(migrated.vendors[0]).not.toHaveProperty('fetchedModels');
        expect(migrated.logicalModels).toEqual([]);
        expect(migrated.groups).toHaveLength(1);
        expect(migrated.groups[0].entries).toHaveLength(2);
        expect(migrated.groups[0].entries[0].fetchedModels).toEqual([]);
        expect(migrated.groups[0].entries[0].mappings).toEqual([]);
        expect(migrated.groups[0].entries[1].fetchedModels).toEqual([]);
        expect(migrated.groups[0].entries[1].mappings).toEqual([]);
        expect(migrated.groups[0].currentLogicalModelId).toBe('');
    });

    it('does not create empty group when no keys', () => {
        const migrated = migrateProvidersToVendorModel([]);
        expect(migrated.vendors).toEqual([]);
        expect(migrated.groups).toEqual([]);
    });

    it('keeps key structure (apiKey/label/enabled) when migrating', () => {
        const migrated = migrateProvidersToVendorModel(normalizeProviders([
            {
                name: 'A',
                endpoint: 'https://a/v1',
                keys: [
                    { label: 'A1', apiKey: 'k1', enabled: true, fetchedModels: ['[1]claude-opus-4-8'] },
                    { label: 'A2', apiKey: 'k2', enabled: false, fetchedModels: ['gemini-3.1-pro-preview-thinking'] },
                ],
            },
        ]));
        expect(migrated.vendors[0].name).toBe('A');
        expect(migrated.groups[0].entries.map(entry => ({ apiKey: entry.apiKey, label: entry.label, enabled: entry.enabled }))).toEqual([
            { apiKey: 'k1', label: 'A1', enabled: true },
            { apiKey: 'k2', label: 'A2', enabled: false },
        ]);
        expect(migrated.groups[0].entries.every(entry => entry.mappings.length === 0)).toBe(true);
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
    function makeVendor(id: string, name: string, rpm = 0): Vendor {
        return normalizeVendor({ id, name, rpm });
    }

    function makeGroupWithEntries(entries: Array<{ id: string; vendorId: string; label: string; enabled?: boolean; mapping?: { realModel: string; logicalModelId: string } }>): Group {
        return normalizeGroup({
            currentLogicalModelId: entries[0]?.mapping?.logicalModelId || '',
            entries: entries.map(entry => ({
                id: entry.id,
                vendorId: entry.vendorId,
                apiKey: `k-${entry.id}`,
                label: entry.label,
                enabled: entry.enabled === undefined ? true : entry.enabled,
                fetchedModels: entry.mapping ? [entry.mapping.realModel] : [],
                mappings: entry.mapping ? [{ id: `m-${entry.id}`, realModel: entry.mapping.realModel, logicalModelId: entry.mapping.logicalModelId }] : [],
            })),
        });
    }

    it('finds entries carrying logical model within the same group graph', () => {
        const vendors = [makeVendor('v1', 'A')];
        const group = makeGroupWithEntries([
            { id: 'e1', vendorId: 'v1', label: 'A1', mapping: { realModel: '[希希2]grok-4.5', logicalModelId: 'l1' } },
            { id: 'e2', vendorId: 'v1', label: 'A2', mapping: { realModel: '[希希2]grok-4.5', logicalModelId: 'l1' } },
        ]);
        const units = groupUnitsForLogicalModel(vendors, group, 'l1');
        expect(units.length).toBe(2);
        expect(units[0].realModel).toBe('[希希2]grok-4.5');
    });

    it('vendor rpm is shared across entries in same group', () => {
        const vendors = [makeVendor('v1', 'A', 1)];
        const group = makeGroupWithEntries([
            { id: 'e1', vendorId: 'v1', label: 'A1', mapping: { realModel: 'm', logicalModelId: 'l1' } },
            { id: 'e2', vendorId: 'v1', label: 'A2', mapping: { realModel: 'm', logicalModelId: 'l1' } },
        ]);
        const r1 = routeGroupOnce(vendors, group, 'l1', { now: 1000 });
        expect(r1.unit).not.toBeNull();
        expect(r1.unit!.vendor.window).toEqual([1000]);
        const r2 = routeGroupOnce(vendors, group, 'l1', { now: 2000 });
        expect(r2.unit).toBeNull();
        expect(r2.reasons.join()).toContain('rpm');
    });

    it('excludes disabled vendor and disabled entry', () => {
        const vendors = [makeVendor('v1', 'A')];
        const group = makeGroupWithEntries([
            { id: 'e1', vendorId: 'v1', label: 'A1', mapping: { realModel: 'm', logicalModelId: 'l1' } },
            { id: 'e2', vendorId: 'v1', label: 'A2', mapping: { realModel: 'm', logicalModelId: 'l1' } },
        ]);
        vendors[0].enabled = false;
        expect(candidateGroupUnits(vendors, group, 'l1')).toHaveLength(0);
        vendors[0].enabled = true;
        group.entries[0].enabled = false;
        expect(candidateGroupUnits(vendors, group, 'l1')).toHaveLength(1);
    });

    it('summarize unavailable lists disabled vendor reasons', () => {
        const vendors = [makeVendor('v1', 'A')];
        const group = makeGroupWithEntries([
            { id: 'e1', vendorId: 'v1', label: 'A1', mapping: { realModel: 'm', logicalModelId: 'l1' } },
        ]);
        vendors[0].enabled = false;
        expect(summarizeGroupUnavailable(vendors, group, 'l1').join()).toContain('disabled');
    });

    it('route picks one of available candidates and records vendor rpm', () => {
        const vendors = [makeVendor('v1', 'A', 1), makeVendor('v2', 'B', 1)];
        const group = makeGroupWithEntries([
            { id: 'e1', vendorId: 'v1', label: 'A1', mapping: { realModel: 'm', logicalModelId: 'l1' } },
            { id: 'e2', vendorId: 'v2', label: 'B1', mapping: { realModel: 'm', logicalModelId: 'l1' } },
        ]);
        const result = routeGroupOnce(vendors, group, 'l1', { now: 1000 });
        expect(result.unit).not.toBeNull();
        expect(['A', 'B']).toContain(result.unit!.vendor.name);
        expect(result.unit!.vendor.window).toEqual([1000]);
        expect(vendorRpmAvailable(result.unit!.vendor, 2000)).toBe(false);
        const other = vendors.find(vendor => vendor.id !== result.unit!.vendor.id)!;
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

    it('route only considers entries whose own mappings carry the logical model (per-Key data)', () => {
        const vendors = normalizeVendors([
            { id: 'v1', name: 'A' },
            { id: 'v2', name: 'B' },
        ]);
        const group = normalizeGroup({
            currentLogicalModelId: 'l1',
            entries: [
                {
                    id: 'e1',
                    vendorId: 'v1',
                    apiKey: 'k1',
                    label: 'K1',
                    enabled: true,
                    fetchedModels: ['m'],
                    mappings: [{ id: 'm1', realModel: 'm', logicalModelId: 'l1' }],
                },
                {
                    id: 'e2',
                    vendorId: 'v2',
                    apiKey: 'k2',
                    label: 'K2',
                    enabled: true,
                    fetchedModels: ['m'],
                    mappings: [], // 该 Key 没拉到/没映射该模型 → 不可选
                },
            ],
        });
        const units = groupUnitsForLogicalModel(vendors, group, 'l1');
        expect(units).toHaveLength(1);
        expect(units[0].entry.id).toBe('e1');
        expect(units[0].vendor.id).toBe('v1');
    });

    it('same logical model can be served by multiple vendors', () => {
        const vendors = [makeVendor('v1', 'X'), makeVendor('v2', 'Y')];
        const group = makeGroupWithEntries([
            { id: 'e1', vendorId: 'v1', label: 'K1', mapping: { realModel: 'grok-4.5', logicalModelId: 'l1' } },
            { id: 'e2', vendorId: 'v2', label: 'K2', mapping: { realModel: 'grok-4.5', logicalModelId: 'l1' } },
        ]);
        expect(group.entries).toHaveLength(2);
        const units = groupUnitsForLogicalModel(vendors, group, 'l1');
        expect(units.length).toBe(2);
        expect(new Set(units.map(unit => unit.vendor.name))).toEqual(new Set(['X', 'Y']));
        expect(vendors[0].id).not.toBe(vendors[1].id);
        for (const unit of units) expect(unit.realModel).toBe('grok-4.5');
    });
});
