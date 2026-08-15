// 模型列表导出：所有 Vendor 已拉取真实模型名的纯文本清单（每行一个，去重排序）。不含密钥。

import { describe, expect, it } from 'vitest';
import { buildModelListText } from '../src/domain/vendor.js';
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

describe('domain/vendor > 模型列表导出（txt）', () => {
    it('每行一个模型名，收集所有 Vendor 的已拉取模型', () => {
        const vendors = [
            makeVendor({ fetchedModels: ['deepseek-chat', 'deepseek-reasoner'] }),
            makeVendor({ id: 'v2', fetchedModels: ['grok-4.5'] }),
        ];
        const text = buildModelListText(vendors);
        const lines = text.split('\n');
        expect(lines).toHaveLength(3);
        expect(lines).toEqual(expect.arrayContaining(['deepseek-chat', 'deepseek-reasoner', 'grok-4.5']));
    });

    it('跨 Vendor 重复的模型名只出现一次', () => {
        const vendors = [
            makeVendor({ fetchedModels: ['gpt-4o', 'gpt-4o-mini'] }),
            makeVendor({ id: 'v2', fetchedModels: ['gpt-4o'] }),
        ];
        const text = buildModelListText(vendors);
        expect(text.split('\n').filter(line => line === 'gpt-4o')).toHaveLength(1);
        expect(text.split('\n')).toHaveLength(2);
    });

    it('按名称排序且空行被剔除', () => {
        const vendors = [
            makeVendor({ fetchedModels: ['  zeta ', '', 'alpha', 'MIXED', 'alpha'] }),
        ];
        const text = buildModelListText(vendors);
        expect(text).toBe('MIXED\nalpha\nzeta');
    });

    it('无任何模型时返回空字符串', () => {
        expect(buildModelListText([makeVendor()])).toBe('');
        expect(buildModelListText([])).toBe('');
    });

    it('导出文本不含密钥字段', () => {
        const vendors = [makeVendor({ fetchedModels: ['gpt-4o'] })];
        const json = buildModelListText(vendors);
        expect(json.toLowerCase()).not.toContain('apikey');
        expect(json.toLowerCase()).not.toContain('secret');
        expect(json.toLowerCase()).not.toContain('authorization');
    });
});
