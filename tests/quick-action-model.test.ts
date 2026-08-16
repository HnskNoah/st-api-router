import { describe, it, expect } from 'vitest';
import { normalizeQuickAction, normalizeQuickActionsForPersist, resolveLogicalModelForAction } from '../src/domain/quick-action.js';
import { normalizeLogicalModels } from '../src/domain/vendor.js';

function sampleLogicalModels() {
    return normalizeLogicalModels([
        { id: 'lm-grok-4.5', name: 'Grok 4.5' },
        { id: 'lm-gemini-flash', name: 'gemini-flash' },
    ]);
}

describe('quick-action normalizeQuickAction', () => {
    it('keeps id/name/preset/model and drops profileId', () => {
        const action = normalizeQuickAction({
            id: 'qa1',
            name: '日常',
            preset: 'Preset A',
            profileId: 'profile-old',
            model: 'grok-4.5',
            sequence: 2,
        });
        expect(action).toEqual({
            id: 'qa1',
            name: '日常',
            preset: 'Preset A',
            model: 'grok-4.5',
            sequence: 2,
        });
        expect('profileId' in action).toBe(false);
    });

    it('fills defaults when empty', () => {
        const action = normalizeQuickAction({}, 3);
        expect(action.id.startsWith('quick-action-')).toBe(true);
        expect(action.name).toBe('');
        expect(action.preset).toBe('');
        expect(action.model).toBe('');
        expect(action.sequence).toBe(3);
        expect('profileId' in action).toBe(false);
    });
});

describe('quick-action normalizeQuickActionsForPersist 自动保存规范化', () => {
    it('空名自动命名为 方案N，sequence 按顺序重排', () => {
        const input = [
            normalizeQuickAction({ id: 'a', name: '', preset: 'P' }, 0),
            normalizeQuickAction({ id: 'b', name: '日常', model: 'grok' }, 1),
            normalizeQuickAction({ id: 'c', name: '', model: 'deepseek' }, 2),
        ];
        const result = normalizeQuickActionsForPersist(input);
        expect(result.map(action => action.name)).toEqual(['方案1', '日常', '方案3']);
        expect(result.map(action => action.sequence)).toEqual([0, 1, 2]);
        expect(result).not.toBe(input);
    });

    it('保留非空名称，不改 id/preset/model', () => {
        const input = [normalizeQuickAction({ id: 'a', name: 'A', preset: 'P1', model: 'm' }, 0)];
        const result = normalizeQuickActionsForPersist(input);
        expect(result[0]).toEqual({ id: 'a', name: 'A', preset: 'P1', model: 'm', sequence: 0 });
    });
});

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
