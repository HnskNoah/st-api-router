import { describe, it, expect } from 'vitest';
import {
    normalizeMappingRule,
    normalizeMappingRules,
    previewMappingRule,
    applyMappingRule,
    applyMappingRules,
    addIgnoreModel,
    removeIgnoreModel,
    isIgnoreModel,
    specialVariantModels,
} from '../src/domain/vendor.js';
import { normalizeGroup } from '../src/domain/vendor.js';
import type { Group, MappingRule } from '../src/types.js';

function makeGroup(entries: Record<string, any>[]): Group {
    return normalizeGroup({ id: 'g1', name: '默认', entries });
}

const feed = makeGroup([
    { id: 'e1', vendorId: 'v1', apiKey: 'k', fetchedModels: ['kimi-k2-0528', 'kimi-k3-turbo', 'deepseek-chat', 'k3-instruct'] },
    { id: 'e2', vendorId: 'v2', apiKey: 'k2', fetchedModels: ['kimi-k2-0528', 'grok-4.5'] },
]);

describe('normalizeMappingRule(s)', () => {
    it('fills id and defaults', () => {
        const rule = normalizeMappingRule({ pattern: ' kimi|k3 ', logicalModelId: ' l1 ' });
        expect(rule.pattern).toBe('kimi|k3');
        expect(rule.logicalModelId).toBe('l1');
        expect(rule.id.startsWith('mapping-rule-')).toBe(true);
    });

    it('normalizes array and drops empty patterns / dupes', () => {
        const rules = normalizeMappingRules([
            { id: 'r1', pattern: 'kimi', logicalModelId: 'l1' },
            { id: 'r2', pattern: '   ', logicalModelId: 'l2' },
            { id: 'r1', pattern: 'xxx', logicalModelId: 'l3' },
        ]);
        expect(rules).toHaveLength(1);
        expect(rules[0].pattern).toBe('kimi');
    });
});

describe('previewMappingRule', () => {
    it('counts matching fetched models across keys, deduped', () => {
        const { names, count } = previewMappingRule([feed], 'kimi|k3');
        // kimi-k2-0528, kimi-k3-turbo, k3-instruct (kimi-k2 appears once despite 2 keys)
        expect(count).toBe(3);
        expect(names).toContain('kimi-k2-0528');
        expect(names).toContain('kimi-k3-turbo');
        expect(names).toContain('k3-instruct');
    });

    it('returns 0 for no match', () => {
        expect(previewMappingRule([feed], 'never-exists').count).toBe(0);
    });

    it('returns 0 for illegal regex', () => {
        expect(previewMappingRule([feed], '(unclosed').count).toBe(0);
    });
});

describe('applyMappingRule', () => {
    it('maps all matching real models to target logical model, across keys', () => {
        const groups = makeGroup([
            { id: 'e1', vendorId: 'v1', apiKey: 'k', fetchedModels: ['kimi-k3-turbo', 'deepseek-chat'] },
        ]);
        const rule: MappingRule = { id: 'r1', pattern: 'kimi', logicalModelId: 'l-kimi' };
        const touched = applyMappingRule([groups], rule);
        expect(touched).toBe(1);
        const mapping = groups.entries[0].mappings.find(m => m.realModel === 'kimi-k3-turbo');
        expect(mapping?.logicalModelId).toBe('l-kimi');
        // deepseek-chat 不受影响
        expect(groups.entries[0].mappings.some(m => m.realModel === 'deepseek-chat')).toBe(false);
    });

    it('reassigns existing mapping to a different logical model', () => {
        const groups = makeGroup([
            { id: 'e1', vendorId: 'v1', apiKey: 'k', fetchedModels: ['kimi-k3-turbo'], mappings: [{ id: 'm1', realModel: 'kimi-k3-turbo', logicalModelId: 'old' }] },
        ]);
        const before = groups.entries[0].mappings[0].logicalModelId;
        expect(before).toBe('old');
        const touched = applyMappingRule([groups], { id: 'r1', pattern: 'kimi', logicalModelId: 'new' });
        expect(touched).toBe(1);
        expect(groups.entries[0].mappings[0].logicalModelId).toBe('new');
    });

    it('does not count re-mapping to same target', () => {
        const groups = makeGroup([
            { id: 'e1', vendorId: 'v1', apiKey: 'k', fetchedModels: ['kimi'], mappings: [{ id: 'm1', realModel: 'kimi', logicalModelId: 'l1' }] },
        ]);
        const touched = applyMappingRule([groups], { id: 'r1', pattern: 'kimi', logicalModelId: 'l1' });
        expect(touched).toBe(0);
    });

    it('no-op on illegal regex or empty logicalId', () => {
        expect(applyMappingRule([feed], { id: 'r', pattern: '(bad', logicalModelId: 'l1' })).toBe(0);
        expect(applyMappingRule([feed], { id: 'r', pattern: 'kimi', logicalModelId: '' })).toBe(0);
    });

    it('applies saved rules in order so later matching rules take precedence', () => {
        const groups = makeGroup([
            { id: 'e1', vendorId: 'v1', apiKey: 'k', fetchedModels: ['kimi-k3-turbo'] },
        ]);
        const touched = applyMappingRules([groups], [
            { id: 'r1', pattern: 'kimi', logicalModelId: 'general' },
            { id: 'r2', pattern: 'k3', logicalModelId: 'k3' },
        ]);

        expect(touched).toBe(2);
        expect(groups.entries[0].mappings[0].logicalModelId).toBe('k3');
    });
});

describe('ignore list', () => {
    it('specialVariantModels collects embedding/reranker/search/thinking/image/cache', () => {
        const g = makeGroup([
            { id: 'e1', vendorId: 'v1', apiKey: 'k', fetchedModels: ['chat-model', 'embedding-v3', 'reranker-v1', 'xxx-search-preview', 'yyy-thinking-x'] },
        ]);
        expect(specialVariantModels([g]).sort()).toEqual(['embedding-v3', 'reranker-v1', 'xxx-search-preview', 'yyy-thinking-x']);
    });

    it('isIgnoreModel returns true for special variant or manual ignore (case-insensitive)', () => {
        expect(isIgnoreModel([], 'embedding-v3')).toBe(true);
        expect(isIgnoreModel(['test-model'], 'TEST-MODEL')).toBe(true);
        expect(isIgnoreModel([], 'normal-chat')).toBe(false);
    });

    it('addIgnoreModel dedupes case-insensitively', () => {
        expect(addIgnoreModel(['a'], 'A')).toEqual(['a']);
        expect(addIgnoreModel([], 'b')).toEqual(['b']);
    });

    it('removeIgnoreModel removes case-insensitively', () => {
        expect(removeIgnoreModel(['a', 'B'], 'b')).toEqual(['a']);
        expect(removeIgnoreModel(['a'], 'x')).toEqual(['a']);
    });
});