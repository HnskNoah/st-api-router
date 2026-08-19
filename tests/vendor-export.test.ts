// 模型列表导出：所有 Key 已拉取真实模型名的纯文本清单（每行一个，去重排序）。不含密钥。

import { describe, expect, it } from 'vitest';
import { buildModelListText, normalizeGroup, sanitizeGroupForExport } from '../src/domain/vendor.js';
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

function makeEntry(id: string, vendorId: string, fetchedModels: string[]) {
    return { id, vendorId, apiKey: 'k', label: id, enabled: true, fetchedModels, mappings: [] };
}

describe('domain/vendor > 模型列表导出（txt）', () => {
    it('每行一个模型名，收集所有 Key 的已拉取模型', () => {
        const groups = [
            makeGroup({ entries: [makeEntry('e1', 'v1', ['deepseek-chat', 'deepseek-reasoner'])] }),
            makeGroup({ id: 'g2', entries: [makeEntry('e2', 'v2', ['grok-4.5'])] }),
        ];
        const text = buildModelListText(groups);
        const lines = text.split('\n');
        expect(lines).toHaveLength(3);
        expect(lines).toEqual(expect.arrayContaining(['deepseek-chat', 'deepseek-reasoner', 'grok-4.5']));
    });

    it('跨 Key 重复的模型名只出现一次', () => {
        const groups = [
            makeGroup({
                entries: [
                    makeEntry('e1', 'v1', ['gpt-4o', 'gpt-4o-mini']),
                    makeEntry('e2', 'v2', ['gpt-4o']),
                ],
            }),
        ];
        const text = buildModelListText(groups);
        expect(text.split('\n').filter(line => line === 'gpt-4o')).toHaveLength(1);
        expect(text.split('\n')).toHaveLength(2);
    });

    it('按名称排序且空行被剔除', () => {
        const groups = [
            makeGroup({ entries: [makeEntry('e1', 'v1', ['  zeta ', '', 'alpha', 'MIXED', 'alpha'])] }),
        ];
        const text = buildModelListText(groups);
        expect(text).toBe('MIXED\nalpha\nzeta');
    });

    it('无任何模型时返回空字符串', () => {
        expect(buildModelListText([makeGroup()])).toBe('');
        expect(buildModelListText([])).toBe('');
    });

    it('导出文本不含密钥字段', () => {
        const groups = [makeGroup({ entries: [makeEntry('e1', 'v1', ['gpt-4o'])] })];
        const json = buildModelListText(groups);
        expect(json.toLowerCase()).not.toContain('apikey');
        expect(json.toLowerCase()).not.toContain('secret');
        expect(json.toLowerCase()).not.toContain('authorization');
    });
});

describe('domain/vendor > sanitizeGroupForExport 完整配置导出脱敏', () => {
    it('剥离 entry.secretId，但保留 apiKey', () => {
        const group = normalizeGroup({
            id: 'g1',
            entries: [{ id: 'e1', vendorId: 'v1', apiKey: 'sk', secretId: 'sid-1', label: 'A' }],
        });
        const sanitized = sanitizeGroupForExport(group);
        expect(sanitized.entries[0].secretId).toBeUndefined();
        expect(sanitized.entries[0].apiKey).toBe('sk');
    });

    it('不修改原对象', () => {
        const group = normalizeGroup({
            id: 'g1',
            entries: [{ id: 'e1', vendorId: 'v1', apiKey: 'sk', secretId: 'sid-1' }],
        });
        sanitizeGroupForExport(group);
        expect(group.entries[0].secretId).toBe('sid-1');
    });

    it('导出剥离本机健康运行时字段（熔断/冷却/诊断）', () => {
        const group = normalizeGroup({
            id: 'g1',
            entries: [{
                id: 'e1', vendorId: 'v1', apiKey: 'sk',
                failStreakByModel: { m: 2 },
                circuitsByModel: { m: 9999999999999 },
                lastErrorKindByModel: { m: 'temp' },
                cooldownMultiplierByModel: { m: 4 },
                lastErrorByRealModel: { m: 'some error' },
            }],
        });
        const sanitized = sanitizeGroupForExport(group);
        const entry = sanitized.entries[0];
        expect(entry.failStreakByModel).toBeUndefined();
        expect(entry.circuitsByModel).toBeUndefined();
        expect(entry.lastErrorKindByModel).toBeUndefined();
        expect(entry.cooldownMultiplierByModel).toBeUndefined();
        expect(entry.lastErrorByRealModel).toBeUndefined();
        // apiKey 仍在，健康字段清理不影响业务数据
        expect(sanitized.entries[0].apiKey).toBe('sk');
    });
});
