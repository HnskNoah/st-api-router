import { describe, it, expect } from 'vitest';
import { groupUnitUnavailabilityReason, modelUnitUnavailabilityReason, groupUnitsForLogicalModel, candidateGroupUnits, type GroupRouteUnit } from '../src/domain/group-routing.js';
import { normalizeGroup, normalizeVendor } from '../src/domain/vendor.js';
import type { Group, Vendor } from '../src/types.js';

function makeVendor(id: string, overrides?: Partial<Vendor>): Vendor {
    return normalizeVendor({ id, name: id, ...overrides });
}

function makeUnit(overrides?: {
    vendor?: Vendor;
    entryOverrides?: Record<string, any>;
    realModel?: string;
}): GroupRouteUnit {
    const vendor = overrides?.vendor ?? makeVendor('v1');
    const entry = normalizeGroup({ entries: [{ vendorId: vendor.id, apiKey: 'sk-xxx', label: 'K1', ...overrides?.entryOverrides }] }).entries[0];
    return {
        vendor,
        entry,
        mapping: { id: 'm1', realModel: overrides?.realModel ?? 'gpt-4o', logicalModelId: 'l1' },
        realModel: overrides?.realModel ?? 'gpt-4o',
    };
}

describe('modelUnitUnavailabilityReason', () => {
    it('returns null when model is not in cooldown', () => {
        const unit = makeUnit();
        expect(modelUnitUnavailabilityReason(unit, 1000)).toBeNull();
    });

    it('returns "cooldown" when model is in cooldown', () => {
        const unit = makeUnit();
        unit.entry.circuitsByModel = { 'gpt-4o': 2000 };
        expect(modelUnitUnavailabilityReason(unit, 1000)).toBe('cooldown');
    });

    it('returns null when cooldown has expired', () => {
        const unit = makeUnit();
        unit.entry.circuitsByModel = { 'gpt-4o': 500 };
        expect(modelUnitUnavailabilityReason(unit, 1000)).toBeNull();
    });

    it('returns null when a different model is in cooldown', () => {
        const unit = makeUnit();
        // 同 Key 上另一个模型冷却，不影响本模型
        unit.entry.circuitsByModel = { 'gemini-pro': 2000 };
        expect(modelUnitUnavailabilityReason(unit, 1000)).toBeNull();
    });
});

describe('groupUnitUnavailabilityReason with model-level cooling', () => {
    it('still returns vendor-level reasons when model is healthy', () => {
        const unit = makeUnit({ vendor: makeVendor('v1', { enabled: false }) });
        expect(groupUnitUnavailabilityReason(unit, 1000)).toBe('disabled');
    });

    it('returns "cooldown" when both vendor and model are healthy but model is in cooldown', () => {
        const unit = makeUnit();
        unit.entry.circuitsByModel = { 'gpt-4o': 2000 };
        expect(groupUnitUnavailabilityReason(unit, 1000)).toBe('cooldown');
    });

    it('returns vendor-level reason when both vendor and model issues exist', () => {
        const unit = makeUnit({ vendor: makeVendor('v1', { enabled: false }) });
        unit.entry.circuitsByModel = { 'gpt-4o': 2000 };
        // Vendor-level check comes first, so returns 'disabled'
        expect(groupUnitUnavailabilityReason(unit, 1000)).toBe('disabled');
    });
});

describe('candidateGroupUnits with model-level cooling', () => {
    it('filters out units whose model is in cooldown', () => {
        const vendor = makeVendor('v1');
        const group = normalizeGroup({
            entries: [{
                vendorId: 'v1',
                apiKey: 'sk-1',
                label: 'K1',
                mappings: [{ id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' }],
            }, {
                vendorId: 'v1',
                apiKey: 'sk-2',
                label: 'K2',
                mappings: [{ id: 'm2', realModel: 'gpt-4o', logicalModelId: 'l1' }],
            }],
        });
        // 让 K1 的 gpt-4o 处于冷却
        group.entries[0].circuitsByModel = { 'gpt-4o': 9999999999999 };
        const candidates = candidateGroupUnits([vendor], group, 'l1', 1000);
        expect(candidates).toHaveLength(1);
        expect(candidates[0].entry.label).toBe('K2');
    });

    it('does not filter out when cooldown has expired', () => {
        const vendor = makeVendor('v1');
        const group = normalizeGroup({
            entries: [{
                vendorId: 'v1',
                apiKey: 'sk-1',
                label: 'K1',
                mappings: [{ id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' }],
            }],
        });
        // 冷却已过期
        group.entries[0].circuitsByModel = { 'gpt-4o': 500 };
        const candidates = candidateGroupUnits([vendor], group, 'l1', 1000);
        expect(candidates).toHaveLength(1);
    });
});

describe('manually disabled real models', () => {
    it('modelUnitUnavailabilityReason reports manually-disabled', () => {
        const unit = makeUnit({ entryOverrides: { disabledModels: ['gpt-4o'] } });
        expect(modelUnitUnavailabilityReason(unit, Date.now())).toBe('manually-disabled');
    });

    it('candidateGroupUnits filters manually disabled units', () => {
        const unit = makeUnit({ entryOverrides: { disabledModels: ['gpt-4o'], mappings: [{ id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' }], fetchedModels: ['gpt-4o'] } });
        const vendors = [unit.vendor];
        const group = normalizeGroup({ id: 'g1', currentLogicalModelId: 'lm1', entries: [unit.entry] });
        expect(candidateGroupUnits(vendors, group, 'lm1')).toHaveLength(0);
    });
});