import { describe, it, expect } from 'vitest';
import { normalizeText, sanitizeName, escapeHtml } from '../src/utils/text.js';
import { makeId } from '../src/utils/id.js';
import { normalizeFormat } from '../src/utils/format.js';
import { normalizeModelList, modelIdsFromPayload } from '../src/utils/model-list.js';
import { buildModelsEndpoint } from '../src/utils/url.js';
import { parseCustomHeaders } from '../src/utils/headers.js';

describe('utils/text', () => {
    it('normalizeText trims and coerces', () => {
        expect(normalizeText(null)).toBe('');
        expect(normalizeText(undefined)).toBe('');
        expect(normalizeText('  hello  ')).toBe('hello');
        expect(normalizeText('')).toBe('');
        expect(normalizeText(42)).toBe('42');
    });

    it('sanitizeName strips control chars and caps length', () => {
        expect(sanitizeName('test')).toBe('test');
        expect(sanitizeName('test\u0000')).toBe('test');
        expect(sanitizeName('test\u007F')).toBe('test');
        expect(sanitizeName('a'.repeat(200))).toHaveLength(120);
    });

    it('escapeHtml escapes HTML entities', () => {
        expect(escapeHtml('<b>"&')).toBe('&lt;b&gt;&quot;&amp;');
        expect(escapeHtml("it's")).toBe('it&#39;s');
    });
});

describe('utils/id', () => {
    it('makeId produces prefixed unique ids', () => {
        const id = makeId();
        expect(id.startsWith('profile-')).toBe(true);
        expect(id.length).toBeGreaterThan('profile-'.length);
        const action = makeId('quick-action');
        expect(action.startsWith('quick-action-')).toBe(true);
        expect(makeId()).not.toBe(makeId());
    });
});

describe('utils/format', () => {
    it('normalizeFormat defaults unknown values to openai', () => {
        expect(normalizeFormat('openai')).toBe('openai');
        expect(normalizeFormat('anthropic')).toBe('anthropic');
        expect(normalizeFormat('gemini')).toBe('gemini');
        expect(normalizeFormat('bogus')).toBe('openai');
        expect(normalizeFormat('')).toBe('openai');
        expect(normalizeFormat(undefined)).toBe('openai');
    });
});

describe('utils/model-list', () => {
    it('normalizeModelList dedupes, trims, caps', () => {
        expect(normalizeModelList([' a ', 'b ', 'a'])).toEqual(['a', 'b']);
        expect(normalizeModelList('not-array')).toEqual([]);
        expect(normalizeModelList(undefined)).toEqual([]);
        expect(normalizeModelList([''])).toEqual([]);
        expect(normalizeModelList(['x'.repeat(600)])).toEqual(['x'.repeat(500)]);
    });

    it('modelIdsFromPayload extracts ids from object or array payloads', () => {
        expect(modelIdsFromPayload({ data: [{ id: 'a' }, { id: 'b' }] })).toEqual(['a', 'b']);
        expect(modelIdsFromPayload(['a', 'b'])).toEqual(['a', 'b']);
        expect(modelIdsFromPayload({ data: [{ id: 'a' }, { id: 'a' }] })).toEqual(['a']);
        expect(modelIdsFromPayload({})).toEqual([]);
        expect(modelIdsFromPayload(null)).toEqual([]);
        expect(modelIdsFromPayload({ data: [{ name: 'x' }, 'y'] })).toEqual(['y']);
    });
});

describe('utils/url', () => {
    it('buildModelsEndpoint appends /models to base url', () => {
        expect(buildModelsEndpoint('https://api.openai.com/v1/chat/completions')).toBe('https://api.openai.com/v1/models');
        expect(buildModelsEndpoint('https://api.openai.com/v1/chat/completions/')).toBe('https://api.openai.com/v1/models');
        expect(buildModelsEndpoint('https://api.openai.com/v1/responses')).toBe('https://api.openai.com/v1/models');
        expect(buildModelsEndpoint('https://api.example.com/v1')).toBe('https://api.example.com/v1/models');
        expect(buildModelsEndpoint('https://api.example.com/v1/')).toBe('https://api.example.com/v1/models');
        expect(buildModelsEndpoint('https://api.example.com/v1/models')).toBe('https://api.example.com/v1/models/models');
        expect(buildModelsEndpoint('https://api.example.com/v1/chat/completions?x=1')).toBe('https://api.example.com/v1/models');
    });
});

describe('utils/headers', () => {
    it('parseCustomHeaders parses object JSON with string values only', () => {
        expect(parseCustomHeaders('{"X-Key":"v","X-Num":5,"": "empty"}')).toEqual({ 'X-Key': 'v' });
        expect(parseCustomHeaders('not json')).toEqual({});
        expect(parseCustomHeaders('[1,2]')).toEqual({});
        expect(parseCustomHeaders('')).toEqual({});
        expect(parseCustomHeaders(null)).toEqual({});
    });
});
