// 模型清单导出：本地已拉取模型 + 映射 + 逻辑模型的结构化清单（不含任何密钥）。

import { describe, expect, it } from 'vitest';
import { buildModelExport } from '../src/domain/vendor.js';
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

describe('domain/vendor > 模型清单导出', () => {
    it('导出包含 Vendor 名称、拉取模型与映射（含逻辑模型名）', () => {
        const vendors = [
            makeVendor({
                name: '硅基流动',
                format: 'custom',
                endpoint: 'https://api.example.com/v1',
                fetchedModels: ['deepseek-chat', 'deepseek-reasoner'],
                mappings: [
                    { id: 'm1', realModel: 'deepseek-chat', logicalModelId: 'l1' },
                    { id: 'm2', realModel: 'deepseek-reasoner', logicalModelId: 'l1' },
                ],
            }),
        ];
        const logicalModels: LogicalModel[] = [
            { id: 'l1', name: 'DeepSeek 系', matchPattern: 'deepseek' },
        ];
        const result = buildModelExport(vendors, logicalModels);
        expect(result.vendors).toHaveLength(1);
        expect(result.vendors[0].name).toBe('硅基流动');
        expect(result.vendors[0].fetchedModels).toEqual(['deepseek-chat', 'deepseek-reasoner']);
        expect(result.vendors[0].mappings[0].logicalModelName).toBe('DeepSeek 系');
        expect(result.logicalModels).toEqual([{ id: 'l1', name: 'DeepSeek 系', matchPattern: 'deepseek' }]);
    });

    it('导出不含任何密钥字段（apiKey/secret/authorization/key）', () => {
        const vendors = [makeVendor({ fetchedModels: ['gpt-4o'], mappings: [] })];
        const result = buildModelExport(vendors, []);
        const json = JSON.stringify(result);
        expect(json.toLowerCase()).not.toContain('apikey');
        expect(json.toLowerCase()).not.toContain('secret');
        expect(json.toLowerCase()).not.toContain('authorization');
        expect(json.toLowerCase()).not.toContain('"key"');
    });

    it('空 Vendor 列表导出为空数组且带 exportedAt 时间戳', () => {
        const result = buildModelExport([], []);
        expect(result.vendors).toEqual([]);
        expect(result.logicalModels).toEqual([]);
        expect(typeof result.exportedAt).toBe('string');
        expect(result.exportedAt.length).toBeGreaterThan(0);
    });

    it('未知逻辑模型 id 的映射逻辑模型名为空字符串', () => {
        const vendors = [
            makeVendor({ mappings: [{ id: 'm1', realModel: 'x', logicalModelId: 'ghost' }] }),
        ];
        const result = buildModelExport(vendors, []);
        expect(result.vendors[0].mappings[0].logicalModelName).toBe('');
    });
});
