// 已归类真实模型：所有 Vendor 已有映射的真实模型（跨 Vendor 去重，带归属逻辑模型 id）。
// 供折叠区"已归类真实模型"胶囊列表展示与改归属。

import { describe, expect, it } from 'vitest';
import { mappedRealModels } from '../src/domain/vendor.js';
import type { Vendor } from '../src/types.js';

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

describe('domain/vendor > mappedRealModels 已归类真实模型', () => {
    it('返回所有 Vendor 已映射的真实模型（跨 Vendor 去重）', () => {
        const vendors = [
            makeVendor({ mappings: [{ id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' }] }),
            makeVendor({
                id: 'v2',
                mappings: [
                    { id: 'm2', realModel: 'gpt-4o', logicalModelId: 'l1' },
                    { id: 'm3', realModel: 'claude-opus-4-8', logicalModelId: 'l2' },
                ],
            }),
        ];
        expect(mappedRealModels(vendors)).toEqual([
            { realModel: 'claude-opus-4-8', logicalModelId: 'l2' },
            { realModel: 'gpt-4o', logicalModelId: 'l1' },
        ]);
    });

    it('同一个真实模型映射到不同逻辑模型时取首个非空归属', () => {
        const vendors = [
            makeVendor({ mappings: [{ id: 'm1', realModel: 'gpt-4o', logicalModelId: '' }] }),
            makeVendor({ id: 'v2', mappings: [{ id: 'm2', realModel: 'gpt-4o', logicalModelId: 'l2' }] }),
        ];
        expect(mappedRealModels(vendors)).toEqual([{ realModel: 'gpt-4o', logicalModelId: 'l2' }]);
    });

    it('空 vendors 或无任何映射时返回空数组', () => {
        expect(mappedRealModels([])).toEqual([]);
        expect(mappedRealModels([makeVendor()])).toEqual([]);
    });
});
