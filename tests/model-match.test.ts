// 逻辑模型正则归类：拉取模型后自动按 matchPattern 归入逻辑模型。
// 行为：正则优先 → 名称精确匹配 → 新建逻辑模型兜底。

import { describe, expect, it } from 'vitest';
import {
    assignRealModel,
    findLogicalModelByPattern,
    normalizeLogicalModel,
} from '../src/domain/vendor.js';
import type { LogicalModel } from '../src/types.js';

const base: Omit<LogicalModel, 'id' | 'name'> = { matchPattern: '' };

describe('domain/vendor > 逻辑模型正则归类', () => {
    it('normalizeLogicalModel 保留 matchPattern', () => {
        const model = normalizeLogicalModel({ id: 'lm-1', name: 'DeepSeek 系', matchPattern: 'deepseek' });
        expect(model.matchPattern).toBe('deepseek');
    });

    it('normalizeLogicalModel 缺省 matchPattern 为空字符串', () => {
        const model = normalizeLogicalModel({ id: 'lm-1', name: 'DeepSeek 系' });
        expect(model.matchPattern).toBe('');
    });

    it('findLogicalModelByPattern 命中第一个匹配正则的逻辑模型', () => {
        const models: LogicalModel[] = [
            { id: 'lm-1', name: 'DeepSeek 系', ...base, matchPattern: 'deepseek' },
            { id: 'lm-2', name: 'Grok 系', ...base, matchPattern: 'grok' },
        ];
        expect(findLogicalModelByPattern(models, 'deepseek-chat')?.id).toBe('lm-1');
        expect(findLogicalModelByPattern(models, 'x-ai/grok-4.5')?.id).toBe('lm-2');
    });

    it('findLogicalModelByPattern 无正则或未命中返回 null', () => {
        const models: LogicalModel[] = [
            { id: 'lm-1', name: 'DeepSeek 系', ...base, matchPattern: 'deepseek' },
            { id: 'lm-2', name: '无正则', ...base },
        ];
        expect(findLogicalModelByPattern(models, 'claude-3-5-sonnet')).toBeNull();
        expect(findLogicalModelByPattern(models, '任意模型')).toBeNull(); // lm-2 无正则不参与
    });

    it('findLogicalModelByPattern 非法正则不抛错且视为未命中', () => {
        const models: LogicalModel[] = [
            { id: 'lm-1', name: '坏正则', ...base, matchPattern: '[' },
        ];
        expect(() => findLogicalModelByPattern(models, 'anything')).not.toThrow();
        expect(findLogicalModelByPattern(models, 'anything')).toBeNull();
    });

    it('assignRealModel 优先正则命中，不新建', () => {
        const models: LogicalModel[] = [
            { id: 'lm-1', name: 'DeepSeek 系', ...base, matchPattern: 'deepseek' },
        ];
        const result = assignRealModel(models, 'deepseek-reasoner');
        expect(result.id).toBe('lm-1');
        expect(models).toHaveLength(1);
    });

    it('assignRealModel 无正则命中时按名称精确匹配', () => {
        const models: LogicalModel[] = [
            { id: 'lm-1', name: 'claude-3-5-sonnet', ...base },
        ];
        const result = assignRealModel(models, 'claude-3-5-sonnet');
        expect(result.id).toBe('lm-1');
        expect(models).toHaveLength(1);
    });

    it('assignRealModel 无任何命中时新建逻辑模型兜底', () => {
        const models: LogicalModel[] = [
            { id: 'lm-1', name: 'DeepSeek 系', ...base, matchPattern: 'deepseek' },
        ];
        const result = assignRealModel(models, 'grok-4.5');
        expect(result.id).not.toBe('lm-1');
        expect(result.name).toBe('grok-4.5');
        expect(models).toHaveLength(2);
    });

    it('assignRealModel 无正则时按核心模型名合并渠道变体（不新建）', () => {
        const models: LogicalModel[] = [
            { id: 'lm-1', name: 'gemini-3.1-pro-preview', ...base },
        ];
        const result = assignRealModel(models, '[新渠道]gemini-3.1-pro-preview');
        expect(result.id).toBe('lm-1');
        expect(models).toHaveLength(1);
    });

    it('assignRealModel 核心名匹配不区分大小写（deepseek 与 DeepSeek 归并）', () => {
        const models: LogicalModel[] = [
            { id: 'lm-1', name: 'deepseek-v4-flash', ...base },
        ];
        const result = assignRealModel(models, 'DeepSeek-v4-flash');
        expect(result.id).toBe('lm-1');
        expect(models).toHaveLength(1);
    });

    it('assignRealModel 用已知逻辑模型的最长后缀识别不定长渠道前缀', () => {
        const models: LogicalModel[] = [
            { id: 'short', name: 'gemini-3', ...base },
            { id: 'long', name: 'gemini-3.5-flash', ...base },
        ];
        expect(assignRealModel(models, '供应商A-gemini-3.5-flash').id).toBe('long');
        expect(assignRealModel(models, 'abc-gemini-3.5-flash').id).toBe('long');
        expect(models).toHaveLength(2);
    });

    it('assignRealModel 不把正常模型后缀误当成渠道前缀', () => {
        const models: LogicalModel[] = [
            { id: 'base', name: 'gemini-3.5-flash', ...base },
        ];
        const result = assignRealModel(models, 'gemini-3.5-flash-lite');
        expect(result.id).not.toBe('base');
        expect(result.name).toBe('gemini-3.5-flash-lite');
    });

    it('assignRealModel 无匹配时新建逻辑模型使用核心名（剥前缀）', () => {
        const models: LogicalModel[] = [];
        const result = assignRealModel(models, '[新渠道]deepseek-v4-flash');
        expect(result.name).toBe('deepseek-v4-flash');
        expect(models.map(model => model.name)).toEqual(['deepseek-v4-flash']);
    });

    it('assignRealModel 正则优先于核心名合并', () => {
        const models: LogicalModel[] = [
            { id: 'lm-1', name: 'Gemini 系', ...base, matchPattern: 'gemini' },
            { id: 'lm-2', name: 'gemini-2.5-pro', ...base },
        ];
        const result = assignRealModel(models, '[新渠道]gemini-2.5-pro');
        expect(result.id).toBe('lm-1'); // 正则命中 Gemini 系，而不是按核心名进 lm-2
    });
});
