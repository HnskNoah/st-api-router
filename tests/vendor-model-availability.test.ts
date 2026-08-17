import { describe, it, expect } from 'vitest';
import { isRealModelUsable, normalizeGroup, normalizeVendor } from '../src/domain/vendor.js';
import type { Group, Vendor } from '../src/types.js';

function vendor(id: string, enabled = true): Vendor {
    return normalizeVendor({ id, name: id, enabled });
}

function group(entries: Array<{ id: string; vendorId: string; enabled?: boolean; apiKey?: string; models?: string[]; mapped?: string[] }>): Group {
    return normalizeGroup({
        id: 'g1',
        entries: entries.map(entry => ({
            id: entry.id,
            vendorId: entry.vendorId,
            apiKey: entry.apiKey ?? 'sk',
            label: entry.id,
            enabled: entry.enabled === undefined ? true : entry.enabled,
            fetchedModels: entry.models ?? [],
            mappings: (entry.mapped ?? []).map(realModel => ({ id: `m-${entry.id}-${realModel}`, realModel, logicalModelId: 'l1' })),
        })),
    });
}

describe('domain/vendor > isRealModelUsable 真实模型可用性', () => {
    it('启用 Vendor + 启用 Key 承载模型时可用', () => {
        const vendors = [vendor('v1')];
        const groups = [group([{ id: 'e1', vendorId: 'v1', models: ['gpt-4o'] }])];
        expect(isRealModelUsable(vendors, groups, 'gpt-4o')).toBe(true);
    });

    it('仅映射承载（无 fetchedModels）也算可用', () => {
        const vendors = [vendor('v1')];
        const groups = [group([{ id: 'e1', vendorId: 'v1', mapped: ['claude-opus-4-8'] }])];
        expect(isRealModelUsable(vendors, groups, 'claude-opus-4-8')).toBe(true);
    });

    it('Vendor 禁用时其真实模型不可用', () => {
        const vendors = [vendor('v1', false)];
        const groups = [group([{ id: 'e1', vendorId: 'v1', models: ['gpt-4o'] }])];
        expect(isRealModelUsable(vendors, groups, 'gpt-4o')).toBe(false);
    });

    it('Key 禁用时其真实模型不可用', () => {
        const vendors = [vendor('v1')];
        const groups = [group([{ id: 'e1', vendorId: 'v1', enabled: false, models: ['gpt-4o'] }])];
        expect(isRealModelUsable(vendors, groups, 'gpt-4o')).toBe(false);
    });

    it('Key 未填 apiKey 视为不可用', () => {
        const vendors = [vendor('v1')];
        const groups = [group([{ id: 'e1', vendorId: 'v1', apiKey: '', models: ['gpt-4o'] }])];
        expect(isRealModelUsable(vendors, groups, 'gpt-4o')).toBe(false);
    });

    it('任一可用承载者即可让模型保持可用', () => {
        const vendors = [vendor('v1')];
        const groups = [group([
            { id: 'e1', vendorId: 'v1', enabled: false, models: ['gpt-4o'] },
            { id: 'e2', vendorId: 'v1', models: ['gpt-4o'] },
        ])];
        expect(isRealModelUsable(vendors, groups, 'gpt-4o')).toBe(true);
    });

    it('无承载者或未知 Vendor 视为不可用', () => {
        const vendors = [vendor('v1')];
        const groups = [group([
            { id: 'e1', vendorId: 'v1', models: ['gpt-4o'] },
            { id: 'e2', vendorId: 'missing', models: ['gpt-4o'] },
        ])];
        expect(isRealModelUsable(vendors, groups, 'gpt-4o')).toBe(true);
        expect(isRealModelUsable(vendors, groups, 'not-carried')).toBe(false);
    });
});
