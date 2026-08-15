// 已归类真实模型：所有 Key（GroupEntry）已有映射的真实模型（跨 Key 去重，带归属逻辑模型 id）。
// 模型数据按 Key 级存放：同一 Vendor 的不同 Key 可以拉到不同模型列表。

import { describe, expect, it } from 'vitest';
import { mappedRealModels } from '../src/domain/vendor.js';
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

describe('domain/vendor > mappedRealModels 已归类真实模型', () => {
    it('返回所有 Key 已映射的真实模型（跨 Key 去重）', () => {
        const groups = [
            makeGroup({
                entries: [
                    {
                        id: 'e1',
                        vendorId: 'v1',
                        apiKey: 'k1',
                        label: 'K1',
                        enabled: true,
                        fetchedModels: [],
                        mappings: [{ id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' }],
                    },
                ],
            }),
            makeGroup({
                id: 'g2',
                entries: [
                    {
                        id: 'e2',
                        vendorId: 'v2',
                        apiKey: 'k2',
                        label: 'K2',
                        enabled: true,
                        fetchedModels: [],
                        mappings: [
                            { id: 'm2', realModel: 'gpt-4o', logicalModelId: 'l1' },
                            { id: 'm3', realModel: 'claude-opus-4-8', logicalModelId: 'l2' },
                        ],
                    },
                ],
            }),
        ];
        expect(mappedRealModels(groups)).toEqual([
            { realModel: 'claude-opus-4-8', logicalModelId: 'l2' },
            { realModel: 'gpt-4o', logicalModelId: 'l1' },
        ]);
    });

    it('同一个真实模型映射到不同逻辑模型时取首个非空归属', () => {
        const groups = [
            makeGroup({
                entries: [
                    {
                        id: 'e1',
                        vendorId: 'v1',
                        apiKey: 'k1',
                        label: 'K1',
                        enabled: true,
                        fetchedModels: [],
                        mappings: [{ id: 'm1', realModel: 'gpt-4o', logicalModelId: '' }],
                    },
                ],
            }),
            makeGroup({
                id: 'g2',
                entries: [
                    {
                        id: 'e2',
                        vendorId: 'v2',
                        apiKey: 'k2',
                        label: 'K2',
                        enabled: true,
                        fetchedModels: [],
                        mappings: [{ id: 'm2', realModel: 'gpt-4o', logicalModelId: 'l2' }],
                    },
                ],
            }),
        ];
        expect(mappedRealModels(groups)).toEqual([{ realModel: 'gpt-4o', logicalModelId: 'l2' }]);
    });

    it('空 groups 或无任何映射时返回空数组', () => {
        expect(mappedRealModels([])).toEqual([]);
        expect(mappedRealModels([makeGroup()])).toEqual([]);
    });
});
