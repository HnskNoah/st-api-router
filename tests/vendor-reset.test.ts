// 重置模型数据：删光全部逻辑模型、所有 Vendor 的映射与已拉取模型列表，分组当前逻辑模型指针置空。
// 供"重置模型数据"按钮使用（重置后由前端重新拉取重建）。

import { describe, expect, it } from 'vitest';
import { resetModelData } from '../src/domain/vendor.js';
import type { Group, LogicalModel, Vendor } from '../src/types.js';

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

describe('domain/vendor > resetModelData 重置模型数据', () => {
    it('清空全部逻辑模型、所有 Vendor 的映射与已拉取模型，分组指针置空', () => {
        const logicalModels: LogicalModel[] = [
            { id: 'l1', name: 'claude-opus-4-8', matchPattern: '' },
            { id: 'l2', name: 'gemini-3.1-pro-preview', matchPattern: '' },
        ];
        const vendors = [
            makeVendor({
                fetchedModels: ['[1]claude-opus-4-8'],
                mappings: [{ id: 'm1', realModel: '[1]claude-opus-4-8', logicalModelId: 'l1' }],
            }),
            makeVendor({
                id: 'v2',
                fetchedModels: ['gemini-3.1-pro-preview'],
                mappings: [{ id: 'm2', realModel: 'gemini-3.1-pro-preview', logicalModelId: 'l2' }],
            }),
        ];
        const groups = [makeGroup(), makeGroup({ id: 'g2', currentLogicalModelId: 'l2' })];
        const result = resetModelData(logicalModels, vendors, groups);
        expect(logicalModels).toEqual([]);
        expect(vendors[0].fetchedModels).toEqual([]);
        expect(vendors[0].mappings).toEqual([]);
        expect(vendors[1].fetchedModels).toEqual([]);
        expect(vendors[1].mappings).toEqual([]);
        expect(groups.every(group => group.currentLogicalModelId === '')).toBe(true);
        expect(result.removedLogicalModels).toBe(2);
        expect(result.removedMappings).toBe(2);
    });

    it('空数据时安全返回 0', () => {
        const result = resetModelData([], [], []);
        expect(result.removedLogicalModels).toBe(0);
        expect(result.removedMappings).toBe(0);
    });

    it('无映射但已有拉取模型的 Vendor 仅清空列表', () => {
        const logicalModels: LogicalModel[] = [{ id: 'l1', name: 'claude-opus-4-8', matchPattern: '' }];
        const vendors = [makeVendor({ fetchedModels: ['[1]claude-opus-4-8'] })];
        const result = resetModelData(logicalModels, vendors, []);
        expect(logicalModels).toEqual([]);
        expect(vendors[0].fetchedModels).toEqual([]);
        expect(result.removedMappings).toBe(0);
    });
});
