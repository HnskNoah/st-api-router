import { describe, it, expect } from 'vitest';
import { resolveLogicalModelForAction } from '../src/domain/quick-action.js';
import { normalizeLogicalModels } from '../src/domain/vendor.js';

function sampleLogicalModels() {
    return normalizeLogicalModels([
        { id: 'lm-grok-4.5', name: 'Grok 4.5' },
        { id: 'lm-gemini-flash', name: 'gemini-flash' },
    ]);
}

describe('quick-action resolveLogicalModelForAction', () => {
    it('matches by logical model id', () => {
        const models = sampleLogicalModels();
        expect(resolveLogicalModelForAction('lm-grok-4.5', models)?.id).toBe('lm-grok-4.5');
    });

    it('matches by logical model name', () => {
        const models = sampleLogicalModels();
        expect(resolveLogicalModelForAction('Grok 4.5', models)?.name).toBe('Grok 4.5');
        expect(resolveLogicalModelForAction('gemini-flash', models)?.id).toBe('lm-gemini-flash');
    });

    it('returns null when no logical model matches', () => {
        const models = sampleLogicalModels();
        expect(resolveLogicalModelForAction('grok-4.5', models)).toBeNull();
        expect(resolveLogicalModelForAction('', models)).toBeNull();
        expect(resolveLogicalModelForAction('Grok 4.5', [])).toBeNull();
    });

    it('matches id before name when both exist', () => {
        const models = normalizeLogicalModels([
            { id: 'lm-x', name: 'y' },
            { id: 'z', name: 'lm-x' },
        ]);
        expect(resolveLogicalModelForAction('lm-x', models)?.id).toBe('lm-x');
    });
});
