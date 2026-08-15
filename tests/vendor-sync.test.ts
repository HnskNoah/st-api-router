// 拉取模型后的同步：映射收敛 + 孤儿逻辑模型回收。
// 行为：以最新拉取结果为权威，清除该 Vendor 不再存在的真实模型映射；
// 并回收没有任何 Vendor 映射引用、且未配置自动归类正则的逻辑模型。

import { describe, expect, it } from 'vitest';
import { pruneOrphanLogicalModels, reconcileVendorMappings } from '../src/domain/vendor.js';
import type { LogicalModel, Vendor } from '../src/types.js';

function makeVendor(overrides: Partial<Vendor> = {}): Vendor {
    return {
        id: 'v1',
        name: 'Vendor A',
        format: 'custom',
        endpoint: 'https://api.example.com/v1',
        enabled: true,
        weight: 1,
        rpm: 0,
        maxContext: 0,
        failStreak: 0,
        window: [],
        successes: 0,
        failures: 0,
        lastError: '',
        updatedAt: '',
        mappings: [],
        fetchedModels: [],
        disabledReason: '',
        ...overrides,
    };
}

function makeLogical(id: string, name: string, matchPattern = ''): LogicalModel {
    return { id, name, matchPattern };
}

describe('domain/vendor > 拉取后同步', () => {
    it('reconcileVendorMappings 保留仍在新列表中的映射', () => {
        const vendor = makeVendor({
            mappings: [
                { id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' },
                { id: 'm2', realModel: 'gpt-4o-mini', logicalModelId: 'l1' },
            ],
        });
        reconcileVendorMappings(vendor, ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']);
        expect(vendor.mappings.map(mapping => mapping.realModel)).toEqual(['gpt-4o', 'gpt-4o-mini']);
    });

    it('reconcileVendorMappings 清除不再出现的真实模型映射（换 Key 后旧模型失效）', () => {
        const vendor = makeVendor({
            mappings: [
                { id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' },
                { id: 'm2', realModel: 'gpt-4o-mini', logicalModelId: 'l1' },
            ],
        });
        const removed = reconcileVendorMappings(vendor, ['gpt-4o-mini']);
        expect(vendor.mappings.map(mapping => mapping.realModel)).toEqual(['gpt-4o-mini']);
        expect(removed).toBe(1);
    });

    it('reconcileVendorMappings 空列表清空全部映射', () => {
        const vendor = makeVendor({
            mappings: [{ id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' }],
        });
        reconcileVendorMappings(vendor, []);
        expect(vendor.mappings).toEqual([]);
    });

    it('pruneOrphanLogicalModels 回收无任何 Vendor 引用且无正则的逻辑模型', () => {
        const models = [
            makeLogical('l1', 'gpt-4o'),
            makeLogical('l2', 'deepseek-chat'),
            makeLogical('l3', 'grok-4.5'),
        ];
        const vendors = [
            makeVendor({ mappings: [{ id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' }] }),
        ];
        const removed = pruneOrphanLogicalModels(models, vendors);
        expect(removed).toContain('l2');
        expect(removed).toContain('l3');
        expect(removed).not.toContain('l1');
        expect(models.map(model => model.id)).toEqual(['l1']);
    });

    it('pruneOrphanLogicalModels 保留配置了自动归类正则的逻辑模型', () => {
        const models = [
            makeLogical('l1', 'DeepSeek 系', 'deepseek'),
            makeLogical('l2', 'Grok 系', 'grok'),
        ];
        const removed = pruneOrphanLogicalModels(models, [makeVendor()]);
        expect(removed).toEqual([]);
        expect(models.map(model => model.id)).toEqual(['l1', 'l2']);
    });

    it('pruneOrphanLogicalModels 任何 Vendor 引用即保留（含多 Vendor 共享）', () => {
        const models = [makeLogical('l1', 'shared'), makeLogical('l2', 'orphan')];
        const vendors = [
            makeVendor({ id: 'v1', mappings: [{ id: 'm1', realModel: 'a', logicalModelId: 'l1' }] }),
            makeVendor({ id: 'v2', mappings: [{ id: 'm2', realModel: 'b', logicalModelId: 'l1' }] }),
        ];
        const removed = pruneOrphanLogicalModels(models, vendors);
        expect(removed).toEqual(['l2']);
        expect(models.map(model => model.id)).toEqual(['l1']);
    });
});
