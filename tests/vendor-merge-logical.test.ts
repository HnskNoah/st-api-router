// 合并逻辑模型：把源逻辑模型名下的全部真实模型映射到目标逻辑模型，然后删除源逻辑模型。
// 供逻辑模型编辑弹窗"修改映射"使用：错误模型批量合并到正确逻辑模型。

import { describe, expect, it } from 'vitest';
import { deleteLogicalModel, mergeLogicalModels } from '../src/domain/vendor.js';
import type { Group, LogicalModel } from '../src/types.js';

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

function makeEntry(id: string, vendorId: string, mappings: { id: string; realModel: string; logicalModelId: string }[]) {
    return { id, vendorId, apiKey: 'k', label: id, enabled: true, fetchedModels: mappings.map(m => m.realModel), mappings };
}

describe('domain/vendor > mergeLogicalModels 合并逻辑模型', () => {
    it('把源逻辑模型名下全部真实模型映射到目标，并删除源逻辑模型', () => {
        const logicalModels: LogicalModel[] = [
            { id: 'source', name: 'DeepSeek 错名', matchPattern: '' },
            { id: 'target', name: 'deepseek-v4-flash', matchPattern: '' },
        ];
        const groups = [
            makeGroup({
                currentLogicalModelId: 'source',
                entries: [
                    makeEntry('e1', 'v1', [
                        { id: 'm1', realModel: 'deepseek-v4-flash', logicalModelId: 'source' },
                        { id: 'm2', realModel: 'deepseek-reasoner', logicalModelId: 'source' },
                    ]),
                    makeEntry('e2', 'v2', [
                        { id: 'm3', realModel: 'deepseek-v4-flash', logicalModelId: 'target' },
                    ]),
                ],
            }),
        ];
        const result = mergeLogicalModels(logicalModels, groups, 'source', 'target');
        expect(result.movedMappings).toBe(2);
        expect(result.removedLogicalModelId).toBe('source');
        expect(logicalModels.map(model => model.id)).toEqual(['target']);
        const entries = groups[0].entries;
        expect(entries[0].mappings.every(mapping => mapping.logicalModelId === 'target')).toBe(true);
        expect(entries[1].mappings[0].logicalModelId).toBe('target');
        // 分组当前模型指针若指向源，改到目标
        expect(groups[0].currentLogicalModelId).toBe('target');
    });

    it('源逻辑模型不存在或无映射时安全返回', () => {
        const logicalModels: LogicalModel[] = [{ id: 'target', name: 'target', matchPattern: '' }];
        const groups = [makeGroup()];
        const result = mergeLogicalModels(logicalModels, groups, 'missing', 'target');
        expect(result.movedMappings).toBe(0);
        expect(logicalModels).toHaveLength(1);
    });

    it('目标与源相同不操作', () => {
        const logicalModels: LogicalModel[] = [{ id: 'same', name: 'same', matchPattern: '' }];
        const groups = [makeGroup()];
        const result = mergeLogicalModels(logicalModels, groups, 'same', 'same');
        expect(result.movedMappings).toBe(0);
        expect(logicalModels).toHaveLength(1);
    });
});

describe('domain/vendor > deleteLogicalModel 删除逻辑模型', () => {
    it('删除逻辑模型及其名下全部映射，修正分组指针', () => {
        const logicalModels: LogicalModel[] = [
            { id: 'l1', name: 'deepseek-v4-flash', matchPattern: '' },
            { id: 'l2', name: 'grok-4.5', matchPattern: '' },
        ];
        const groups = [
            makeGroup({
                currentLogicalModelId: 'l1',
                entries: [
                    makeEntry('e1', 'v1', [
                        { id: 'm1', realModel: 'deepseek-v4-flash', logicalModelId: 'l1' },
                        { id: 'm2', realModel: 'grok-4.5', logicalModelId: 'l2' },
                    ]),
                ],
            }),
        ];
        const result = deleteLogicalModel(logicalModels, groups, 'l1');
        expect(result.removedMappings).toBe(1);
        expect(logicalModels.map(model => model.id)).toEqual(['l2']);
        expect(groups[0].entries[0].mappings.map(mapping => mapping.realModel)).toEqual(['grok-4.5']);
        expect(groups[0].currentLogicalModelId).toBe('');
    });

    it('逻辑模型不存在时安全返回 0', () => {
        const logicalModels: LogicalModel[] = [{ id: 'l2', name: 'grok-4.5', matchPattern: '' }];
        const groups = [makeGroup()];
        const result = deleteLogicalModel(logicalModels, groups, 'missing');
        expect(result.removedMappings).toBe(0);
        expect(logicalModels).toHaveLength(1);
    });
});
