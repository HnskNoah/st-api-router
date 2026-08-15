// 导入配置合并：vendors / logicalModels / groups 按 id 更新或新增，不删除现有数据。
// 供"导入数据"按钮使用（合并模式，文件为部分快照）。

import { describe, expect, it } from 'vitest';
import { mergeImportedRoutingConfig } from '../src/domain/vendor.js';
import type { Group, LogicalModel, Vendor } from '../src/types.js';

function makeVendor(id: string, name = 'Vendor'): Vendor {
    return {
        id,
        name,
        format: 'custom',
        endpoint: 'https://api.example.com/v1',
        rpm: 3,
        maxContext: 0,
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

function makeGroup(id: string, entries: Group['entries'] = []): Group {
    return { id, name: id, enabled: true, currentLogicalModelId: '', entries };
}

describe('domain/vendor > mergeImportedRoutingConfig 导入配置合并', () => {
    it('按 id 更新已有并新增缺失，不删除现有', () => {
        const current = {
            vendors: [makeVendor('v1', '旧名')],
            logicalModels: [{ id: 'l1', name: '旧逻辑', matchPattern: '' }],
            groups: [makeGroup('g1')],
        };
        const imported = {
            vendors: [
                { ...makeVendor('v1', '新名') },
                makeVendor('v2', '新增'),
            ],
            logicalModels: [
                { id: 'l1', name: '新逻辑', matchPattern: 'new' },
                { id: 'l2', name: '额外', matchPattern: '' },
            ],
            groups: [makeGroup('g1'), makeGroup('g2')],
        };
        const merged = mergeImportedRoutingConfig(current, imported);
        expect(merged.vendors.map(v => v.id).sort()).toEqual(['v1', 'v2']);
        expect(merged.vendors.find(v => v.id === 'v1')?.name).toBe('新名');
        expect(merged.logicalModels.map(l => l.id).sort()).toEqual(['l1', 'l2']);
        expect(merged.logicalModels.find(l => l.id === 'l1')?.name).toBe('新逻辑');
        expect(merged.groups.map(g => g.id).sort()).toEqual(['g1', 'g2']);
    });

    it('group entries 按 entry.id 合并（已有更新，缺失新增）', () => {
        const current = [makeGroup('g1', [{
            id: 'e1',
            vendorId: 'v1',
            apiKey: 'old-key',
            label: '旧 Key',
            enabled: true,
            fetchedModels: ['a'],
            mappings: [],
        }])];
        const imported = [makeGroup('g1', [
            {
                id: 'e1',
                vendorId: 'v1',
                apiKey: 'new-key',
                label: '新 Key',
                enabled: false,
                fetchedModels: ['b'],
                mappings: [{ id: 'm1', realModel: 'b', logicalModelId: 'l1' }],
            },
            {
                id: 'e2',
                vendorId: 'v2',
                apiKey: 'k2',
                label: 'K2',
                enabled: true,
                fetchedModels: [],
                mappings: [],
            },
        ])];
        const merged = mergeImportedRoutingConfig({ vendors: [], logicalModels: [], groups: current }, { vendors: [], logicalModels: [], groups: imported });
        const entries = merged.groups[0].entries;
        expect(entries.map(e => e.id).sort()).toEqual(['e1', 'e2']);
        expect(entries.find(e => e.id === 'e1')?.apiKey).toBe('new-key');
        expect(entries.find(e => e.id === 'e1')?.enabled).toBe(false);
        expect(entries.find(e => e.id === 'e2')?.apiKey).toBe('k2');
    });

    it('空导入不破坏现有数据', () => {
        const current = {
            vendors: [makeVendor('v1')],
            logicalModels: [{ id: 'l1', name: 'l', matchPattern: '' }],
            groups: [makeGroup('g1')],
        };
        const merged = mergeImportedRoutingConfig(current, { vendors: [], logicalModels: [], groups: [] });
        expect(merged.vendors).toHaveLength(1);
        expect(merged.logicalModels).toHaveLength(1);
        expect(merged.groups).toHaveLength(1);
    });
});
