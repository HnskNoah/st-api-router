// 重置模型数据：删光全部逻辑模型、所有 Key 的映射与已拉取模型列表，分组当前逻辑模型指针置空。
// 供"重置模型数据"按钮使用（重置后由前端重新拉取重建）。

import { describe, expect, it } from 'vitest';
import { resetModelData } from '../src/domain/vendor.js';
import type { Group, LogicalModel } from '../src/types.js';

function makeGroup(overrides: Partial<Group> = {}): Group {
    return {
        id: 'g1',
        name: '默认分组',
        enabled: true,
        currentLogicalModelId: 'l1',
        entries: [],
        ...overrides,
    };
}

function makeEntry(id: string, vendorId: string, fetchedModels: string[], mappings: { id: string; realModel: string; logicalModelId: string }[] = []) {
    return { id, vendorId, apiKey: 'k', label: id, enabled: true, fetchedModels, mappings };
}

describe('domain/vendor > resetModelData 重置模型数据', () => {
    it('清空全部逻辑模型、所有 Key 的映射与已拉取模型，分组指针置空', () => {
        const logicalModels: LogicalModel[] = [
            { id: 'l1', name: 'claude-opus-4-8', matchPattern: '' },
            { id: 'l2', name: 'gemini-3.1-pro-preview', matchPattern: '' },
        ];
        const groups = [
            makeGroup({
                entries: [makeEntry('e1', 'v1', ['[1]claude-opus-4-8'], [{ id: 'm1', realModel: '[1]claude-opus-4-8', logicalModelId: 'l1' }])],
            }),
            makeGroup({
                id: 'g2',
                currentLogicalModelId: 'l2',
                entries: [makeEntry('e2', 'v2', ['gemini-3.1-pro-preview'], [{ id: 'm2', realModel: 'gemini-3.1-pro-preview', logicalModelId: 'l2' }])],
            }),
        ];
        const result = resetModelData(logicalModels, groups);
        expect(logicalModels).toEqual([]);
        expect(groups[0].entries[0].fetchedModels).toEqual([]);
        expect(groups[0].entries[0].mappings).toEqual([]);
        expect(groups[1].entries[0].fetchedModels).toEqual([]);
        expect(groups[1].entries[0].mappings).toEqual([]);
        expect(groups.every(group => group.currentLogicalModelId === '')).toBe(true);
        expect(result.removedLogicalModels).toBe(2);
        expect(result.removedMappings).toBe(2);
    });

    it('空数据时安全返回 0', () => {
        const result = resetModelData([], []);
        expect(result.removedLogicalModels).toBe(0);
        expect(result.removedMappings).toBe(0);
    });

    it('无映射但已有拉取模型的 Key 仅清空列表', () => {
        const logicalModels: LogicalModel[] = [{ id: 'l1', name: 'claude-opus-4-8', matchPattern: '' }];
        const groups = [makeGroup({ entries: [makeEntry('e1', 'v1', ['[1]claude-opus-4-8'])] })];
        const result = resetModelData(logicalModels, groups);
        expect(logicalModels).toEqual([]);
        expect(groups[0].entries[0].fetchedModels).toEqual([]);
        expect(result.removedMappings).toBe(0);
    });
});
