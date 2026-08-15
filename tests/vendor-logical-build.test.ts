// 从已拉取模型批量创建逻辑模型：
// 每个核心模型独立成一个逻辑模型（不合并不同型号），
// 渠道/变体前缀（[xx]、gcli-、假流式-、xxx/）剥离后合并到同一核心模型，
// 跳过 search/thinking/image 变体。

import { describe, expect, it } from 'vitest';
import { buildLogicalModelsFromFetched, canonicalModelName, isSpecialVariant } from '../src/domain/vendor.js';
import type { LogicalModel } from '../src/types.js';

describe('domain/vendor > isSpecialVariant 特殊变体判断', () => {
    it('包含 search/thinking/image/cache（大小写不敏感）为真', () => {
        expect(isSpecialVariant('gemini-3.1-pro-preview-search')).toBe(true);
        expect(isSpecialVariant('[2]claude-opus-4-8-thinking')).toBe(true);
        expect(isSpecialVariant('gpt-image-2')).toBe(true);
        expect(isSpecialVariant('grok-4.5-Thinking')).toBe(true);
        expect(isSpecialVariant('gcli-gemini-2.5-flash-maxthinking-search')).toBe(true);
        expect(isSpecialVariant('gemini-2.5-pro-cache')).toBe(true);
        expect(isSpecialVariant('假流式-gemini-3.1-pro-preview-cache')).toBe(true);
    });

    it('普通模型为假', () => {
        expect(isSpecialVariant('gemini-2.5-pro')).toBe(false);
        expect(isSpecialVariant('deepseek-v4-flash')).toBe(false);
        expect(isSpecialVariant('[1]claude-opus-4-8')).toBe(false);
        expect(isSpecialVariant('')).toBe(false);
        expect(isSpecialVariant('grok-4.5')).toBe(false);
    });
});

describe('domain/vendor > canonicalModelName 核心模型名提取', () => {
    it('剥离渠道标签前缀', () => {
        expect(canonicalModelName('[1]claude-opus-4-8')).toBe('claude-opus-4-8');
        expect(canonicalModelName('[南涧]deepseek-v4-flash')).toBe('deepseek-v4-flash');
        expect(canonicalModelName('[v2]gemini-2.5-pro')).toBe('gemini-2.5-pro');
        expect(canonicalModelName('[NVIDIA]DeepSeek-V4-Pro')).toBe('DeepSeek-V4-Pro');
    });

    it('剥离 gcli- 与假流式- 前缀', () => {
        expect(canonicalModelName('gcli-gemini-2.5-pro')).toBe('gemini-2.5-pro');
        expect(canonicalModelName('假流式-gemini-2.5-pro')).toBe('gemini-2.5-pro');
        expect(canonicalModelName('[v2]假流式-gemini-2.5-pro')).toBe('gemini-2.5-pro');
    });

    it('剥离斜杠前缀（gcli-假流式/、cline-pass/、anthropic/）', () => {
        expect(canonicalModelName('gcli-假流式/gemini-2.5-flash')).toBe('gemini-2.5-flash');
        expect(canonicalModelName('cline-pass/glm-5.2')).toBe('glm-5.2');
        expect(canonicalModelName('anthropic/claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
        expect(canonicalModelName('catie-火山填表总结/doubao-seed-2.0-lite')).toBe('doubao-seed-2.0-lite');
    });

    it('无前缀的模型名原样返回', () => {
        expect(canonicalModelName('deepseek-v4-flash')).toBe('deepseek-v4-flash');
        expect(canonicalModelName('claude-opus-5')).toBe('claude-opus-5');
    });
});

describe('domain/vendor > 从已拉取模型批量创建逻辑模型', () => {
    it('渠道/假流式变体合并到同一核心逻辑模型', () => {
        const existing: LogicalModel[] = [];
        const models = ['假流式-gemini-3.1-pro-preview', 'gemini-3.1-pro-preview', 'gcli-假流式/gemini-3.1-pro-preview'];
        const result = buildLogicalModelsFromFetched(models, existing);
        expect(result.created.map(model => model.name)).toEqual(['gemini-3.1-pro-preview']);
        expect(existing).toHaveLength(1);
        expect(result.skipped).toEqual([]);
    });

    it('不同核心模型保持独立，不合并', () => {
        const existing: LogicalModel[] = [];
        const result = buildLogicalModelsFromFetched(['[1]claude-opus-4-8', '[2]claude-opus-4-8', 'claude-opus-5', 'deepseek-v4-flash'], existing);
        expect(result.created.map(model => model.name).sort()).toEqual(['claude-opus-4-8', 'claude-opus-5', 'deepseek-v4-flash']);
    });

    it('跳过包含 search/thinking/image 的模型（含带前缀变体）', () => {
        const existing: LogicalModel[] = [];
        const models = ['gemini-3.1-pro-preview-search', '[2]claude-opus-4-8-thinking', 'gpt-image-2', 'gemini-2.5-pro'];
        const result = buildLogicalModelsFromFetched(models, existing);
        expect(result.created.map(model => model.name)).toEqual(['gemini-2.5-pro']);
        expect(result.skipped).toEqual(['gemini-3.1-pro-preview-search', '[2]claude-opus-4-8-thinking', 'gpt-image-2']);
    });

    it('大小写不敏感跳过（如 grok-4.5-Thinking）', () => {
        const existing: LogicalModel[] = [];
        const result = buildLogicalModelsFromFetched(['grok-4.5-Thinking', 'grok-4.5'], existing);
        expect(result.created.map(model => model.name)).toEqual(['grok-4.5']);
        expect(result.skipped).toEqual(['grok-4.5-Thinking']);
    });

    it('已存在同名核心逻辑模型不重复创建', () => {
        const existing: LogicalModel[] = [{ id: 'l1', name: 'claude-opus-4-8', matchPattern: '' }];
        const result = buildLogicalModelsFromFetched(['[1]claude-opus-4-8', 'claude-opus-5'], existing);
        expect(result.created.map(model => model.name)).toEqual(['claude-opus-5']);
        expect(existing).toHaveLength(2);
    });

    it('去重与空值剔除', () => {
        const existing: LogicalModel[] = [];
        const models = ['[1]claude-opus-4-8', '  ', '', '[2]claude-opus-4-8', '[1]claude-opus-4-8'];
        const result = buildLogicalModelsFromFetched(models, existing);
        expect(result.created.map(model => model.name)).toEqual(['claude-opus-4-8']);
    });

    it('无模型或无新增时 created 为空数组', () => {
        const existing: LogicalModel[] = [];
        expect(buildLogicalModelsFromFetched([], existing).created).toEqual([]);
        const result = buildLogicalModelsFromFetched(['gemini-3.5-flash-search'], existing);
        expect(result.created).toEqual([]);
        expect(result.skipped).toHaveLength(1);
    });

    it('创建的逻辑模型 matchPattern 为空（不自动归类，保持核心模型对应）', () => {
        const existing: LogicalModel[] = [];
        const result = buildLogicalModelsFromFetched(['deepseek-v4-flash'], existing);
        expect(result.created[0].matchPattern).toBe('');
    });
});
