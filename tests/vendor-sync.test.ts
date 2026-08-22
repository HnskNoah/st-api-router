// 拉取模型后的同步：Key 级映射收敛 + 孤儿逻辑模型回收。
// 行为：以最新拉取结果为权威，清除该 Key 不再存在的真实模型映射；
// 并回收没有任何 Key 映射引用、且未配置自动归类正则的逻辑模型。

import { describe, expect, it } from 'vitest';
import { pruneOrphanLogicalModels, reconcileEntryMappings } from '../src/domain/vendor.js';
import type { Group, GroupEntry, LogicalModel } from '../src/types.js';

function makeGroup(overrides: Partial<Group> = {}): Group {
    return {
        id: 'g1',
        name: '默认分组',
        enabled: true,
        currentLogicalModelId: '',
        entries: [],
        ...overrides,
    };
}

function makeEntry(overrides: Partial<GroupEntry> = {}): GroupEntry {
    return {
        id: 'e1',
        vendorId: 'v1',
        apiKey: 'k',
        label: 'K1',
        enabled: true,
        fetchedModels: [],
        mappings: [],
        ...overrides,
    };
}

function makeLogical(id: string, name: string, matchPattern = ''): LogicalModel {
    return { id, name, matchPattern };
}

describe('domain/vendor > 拉取后同步', () => {
    it('reconcileEntryMappings 保留仍在新列表中的映射', () => {
        const entry = makeEntry({
            mappings: [
                { id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' },
                { id: 'm2', realModel: 'gpt-4o-mini', logicalModelId: 'l1' },
            ],
        });
        reconcileEntryMappings(entry, ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']);
        expect(entry.mappings.map(mapping => mapping.realModel)).toEqual(['gpt-4o', 'gpt-4o-mini']);
    });

    it('reconcileEntryMappings 清除不再出现的真实模型映射（换 Key 后旧模型失效）', () => {
        const entry = makeEntry({
            mappings: [
                { id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' },
                { id: 'm2', realModel: 'gpt-4o-mini', logicalModelId: 'l1' },
            ],
        });
        const removed = reconcileEntryMappings(entry, ['gpt-4o-mini']);
        expect(entry.mappings.map(mapping => mapping.realModel)).toEqual(['gpt-4o-mini']);
        expect(removed).toBe(1);
    });

    it('reconcileEntryMappings 同步清扫已消失模型的健康记录键', () => {
        const entry = makeEntry({
            fetchedModels: ['kept'],
            mappings: [{ id: 'm-gone', realModel: 'gone', logicalModelId: 'l1' }],
            failStreakByModel: { kept: 1, gone: 2 },
            circuitsByModel: { gone: 12345 },
            lastErrorByRealModel: { kept: 'x', gone: 'y' },
        });
        reconcileEntryMappings(entry, ['kept']);
        expect(entry.mappings).toEqual([]);
        expect(entry.failStreakByModel).toEqual({ kept: 1 });
        expect(entry.lastErrorByRealModel).toEqual({ kept: 'x' });
        expect(entry.circuitsByModel).toEqual({});
    });

    it('reconcileEntryMappings 空列表清空全部映射', () => {
        const entry = makeEntry({
            mappings: [{ id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' }],
        });
        reconcileEntryMappings(entry, []);
        expect(entry.mappings).toEqual([]);
    });

    it('pruneOrphanLogicalModels 回收无任何 Key 引用且无正则的逻辑模型', () => {
        const models = [
            makeLogical('l1', 'gpt-4o'),
            makeLogical('l2', 'deepseek-chat'),
            makeLogical('l3', 'grok-4.5'),
        ];
        const groups = [
            makeGroup({
                entries: [makeEntry({ mappings: [{ id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' }] })],
            }),
        ];
        const removed = pruneOrphanLogicalModels(models, groups);
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
        const removed = pruneOrphanLogicalModels(models, [makeGroup()]);
        expect(removed).toEqual([]);
        expect(models.map(model => model.id)).toEqual(['l1', 'l2']);
    });

    it('pruneOrphanLogicalModels 任何 Key 引用即保留（含多 Key 共享）', () => {
        const models = [makeLogical('l1', 'shared'), makeLogical('l2', 'orphan')];
        const groups = [
            makeGroup({
                entries: [
                    makeEntry({ id: 'e1', vendorId: 'v1', mappings: [{ id: 'm1', realModel: 'a', logicalModelId: 'l1' }] }),
                    makeEntry({ id: 'e2', vendorId: 'v2', mappings: [{ id: 'm2', realModel: 'b', logicalModelId: 'l1' }] }),
                ],
            }),
        ];
        const removed = pruneOrphanLogicalModels(models, groups);
        expect(removed).toEqual(['l2']);
        expect(models.map(model => model.id)).toEqual(['l1']);
    });
});
