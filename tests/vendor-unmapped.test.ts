// 未归类模型：已拉取但尚未映射到任何逻辑模型的真实模型（排除特殊变体）。
// 手动补选：给真实模型指定逻辑模型，对所有包含该模型的 Vendor 生效。

import { describe, expect, it } from 'vitest';
import { assignModelToLogical, findUnmappedModels } from '../src/domain/vendor.js';
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

describe('domain/vendor > findUnmappedModels 未归类模型', () => {
    it('返回已拉取但无映射的真实模型（跨 Vendor 去重）', () => {
        const vendors = [
            makeVendor({ fetchedModels: ['gpt-4o', 'gpt-4o-mini'] }),
            makeVendor({ id: 'v2', fetchedModels: ['gpt-4o', 'claude-opus-4-8'] }),
        ];
        const unmapped = findUnmappedModels(vendors);
        expect(unmapped.sort()).toEqual(['claude-opus-4-8', 'gpt-4o', 'gpt-4o-mini']);
    });

    it('已有映射的真实模型不计入未归类', () => {
        const vendors = [
            makeVendor({
                fetchedModels: ['gpt-4o', 'gpt-4o-mini'],
                mappings: [{ id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' }],
            }),
        ];
        expect(findUnmappedModels(vendors)).toEqual(['gpt-4o-mini']);
    });

    it('排除特殊变体（search/thinking/image/cache）', () => {
        const vendors = [
            makeVendor({ fetchedModels: ['gemini-2.5-pro', 'gemini-2.5-pro-cache', 'gpt-image-2'] }),
        ];
        expect(findUnmappedModels(vendors)).toEqual(['gemini-2.5-pro']);
    });

    it('空 vendor 或全部已映射时返回空数组', () => {
        expect(findUnmappedModels([])).toEqual([]);
        const vendors = [
            makeVendor({
                fetchedModels: ['gpt-4o'],
                mappings: [{ id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l1' }],
            }),
        ];
        expect(findUnmappedModels(vendors)).toEqual([]);
    });
});

describe('domain/vendor > assignModelToLogical 手动补选', () => {
    it('为所有包含该真实模型的 Vendor 建立映射', () => {
        const vendors = [
            makeVendor({ fetchedModels: ['gpt-4o'] }),
            makeVendor({ id: 'v2', fetchedModels: ['gpt-4o', 'claude-opus-4-8'] }),
            makeVendor({ id: 'v3', fetchedModels: ['claude-opus-4-8'] }),
        ];
        const touched = assignModelToLogical(vendors, 'gpt-4o', 'l1');
        expect(touched).toBe(2);
        expect(vendors[0].mappings).toEqual([{ id: expect.any(String), realModel: 'gpt-4o', logicalModelId: 'l1' }]);
        expect(vendors[1].mappings).toEqual([{ id: expect.any(String), realModel: 'gpt-4o', logicalModelId: 'l1' }]);
        expect(vendors[2].mappings).toEqual([]);
    });

    it('Vendor 已有该真实模型的映射时更新而不是重复添加', () => {
        const vendors = [
            makeVendor({
                fetchedModels: ['gpt-4o'],
                mappings: [{ id: 'm1', realModel: 'gpt-4o', logicalModelId: 'l-old' }],
            }),
        ];
        const touched = assignModelToLogical(vendors, 'gpt-4o', 'l-new');
        expect(touched).toBe(1);
        expect(vendors[0].mappings).toHaveLength(1);
        expect(vendors[0].mappings[0].logicalModelId).toBe('l-new');
    });

    it('没有任何 Vendor 包含该模型时返回 0', () => {
        const vendors = [makeVendor({ fetchedModels: ['claude-opus-4-8'] })];
        expect(assignModelToLogical(vendors, 'gpt-4o', 'l1')).toBe(0);
        expect(vendors[0].mappings).toEqual([]);
    });
});
