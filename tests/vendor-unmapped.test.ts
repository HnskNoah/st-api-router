// 未归类模型：Key 级已拉取但尚未映射到任何逻辑模型的真实模型（排除特殊变体）。
// 手动补选：给真实模型指定逻辑模型，对所有包含该模型的 Key 生效。

import { describe, expect, it } from 'vitest';
import { assignModelToLogical, findUnmappedModels, unmapRealModel } from '../src/domain/vendor.js';
import type { Group } from '../src/types.js';

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

function makeEntry(id: string, vendorId: string, fetchedModels: string[], mappings: { id: string; realModel: string; logicalModelId: string }[] = []) {
    return { id, vendorId, apiKey: 'k', label: id, enabled: true, fetchedModels, mappings };
}

describe('domain/vendor > findUnmappedModels 未归类模型', () => {
    it('返回已拉取但无映射的真实模型（跨 Key 去重）', () => {
        const groups = [
            makeGroup({ entries: [makeEntry('e1', 'v1', ['gpt-4o', 'gpt-4o-mini'])] }),
            makeGroup({ id: 'g2', entries: [makeEntry('e2', 'v2', ['gpt-4o', 'claude-opus-4-8'])] }),
        ];
        const unmapped = findUnmappedModels(groups);
        expect(unmapped.sort()).toEqual(['claude-opus-4-8', 'gpt-4o', 'gpt-4o-mini']);
    });

    it('已有映射的真实模型不计入未归类', () => {
        const groups = [
            makeGroup({
                entries: [makeEntry('e1', 'v1', ['gpt-4o', 'gpt-4o-mini'], [{ id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' }])],
            }),
        ];
        expect(findUnmappedModels(groups)).toEqual(['gpt-4o-mini']);
    });

    it('特殊变体（search/thinking/image/cache）也进入未归类', () => {
        const groups = [
            makeGroup({ entries: [makeEntry('e1', 'v1', ['gemini-2.5-pro', 'gemini-2.5-pro-cache', 'gpt-image-2'])] }),
        ];
        expect(findUnmappedModels(groups).sort()).toEqual(['gemini-2.5-pro', 'gemini-2.5-pro-cache', 'gpt-image-2']);
    });

    it('embedding 与 reranker 也进入未归类', () => {
        const groups = [
            makeGroup({ entries: [makeEntry('e1', 'v1', ['text-embedding-3-large', 'bge-reranker-v2-m3'])] }),
        ];
        expect(findUnmappedModels(groups).sort()).toEqual(['bge-reranker-v2-m3', 'text-embedding-3-large']);
    });

    it('空 groups 或全部已映射时返回空数组', () => {
        expect(findUnmappedModels([])).toEqual([]);
        const groups = [
            makeGroup({
                entries: [makeEntry('e1', 'v1', ['gpt-4o'], [{ id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' }])],
            }),
        ];
        expect(findUnmappedModels(groups)).toEqual([]);
    });
});

describe('domain/vendor > assignModelToLogical 手动补选', () => {
    it('为所有包含该真实模型的 Key 建立映射', () => {
        const groups = [
            makeGroup({
                entries: [
                    makeEntry('e1', 'v1', ['gpt-4o']),
                    makeEntry('e2', 'v2', ['gpt-4o', 'claude-opus-4-8']),
                    makeEntry('e3', 'v3', ['claude-opus-4-8']),
                ],
            }),
        ];
        const touched = assignModelToLogical(groups, 'gpt-4o', 'l1');
        expect(touched).toBe(2);
        expect(groups[0].entries[0].mappings).toEqual([{ id: expect.any(String), realModel: 'gpt-4o', logicalModelId: 'l1' }]);
        expect(groups[0].entries[1].mappings).toEqual([{ id: expect.any(String), realModel: 'gpt-4o', logicalModelId: 'l1' }]);
        expect(groups[0].entries[2].mappings).toEqual([]);
    });

    it('Key 已有该真实模型的映射时更新而不是重复添加', () => {
        const groups = [
            makeGroup({
                entries: [makeEntry('e1', 'v1', ['gpt-4o'], [{ id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l-old' }])],
            }),
        ];
        const touched = assignModelToLogical(groups, 'gpt-4o', 'l-new');
        expect(touched).toBe(1);
        expect(groups[0].entries[0].mappings).toHaveLength(1);
        expect(groups[0].entries[0].mappings[0].logicalModelId).toBe('l-new');
    });

    it('没有任何 Key 包含该模型时返回 0', () => {
        const groups = [makeGroup({ entries: [makeEntry('e1', 'v1', ['claude-opus-4-8'])] })];
        expect(assignModelToLogical(groups, 'gpt-4o', 'l1')).toBe(0);
        expect(groups[0].entries[0].mappings).toEqual([]);
    });
});

describe('domain/vendor > unmapRealModel 删除真实模型映射', () => {
    it('删除所有 Key 中该真实模型的映射，进入未归类', () => {
        const groups = [
            makeGroup({
                entries: [
                    makeEntry('e1', 'v1', ['gpt-4o', 'claude-opus-4-8'], [
                        { id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' },
                        { id: 'm2', realModel: 'claude-opus-4-8', logicalModelId: 'l2' },
                    ]),
                    makeEntry('e2', 'v2', ['gpt-4o'], [{ id: 'm3', realModel: 'gpt-4o', logicalModelId: 'l1' }]),
                ],
            }),
        ];
        const removed = unmapRealModel(groups, 'gpt-4o');
        expect(removed).toBe(2);
        expect(groups[0].entries[0].mappings.map(mapping => mapping.realModel)).toEqual(['claude-opus-4-8']);
        expect(groups[0].entries[1].mappings).toEqual([]);
    });

    it('没有该模型映射时返回 0', () => {
        const groups = [makeGroup({ entries: [makeEntry('e1', 'v1', ['gpt-4o'])] })];
        expect(unmapRealModel(groups, 'gpt-4o')).toBe(0);
        expect(groups[0].entries[0].mappings).toEqual([]);
    });
});
