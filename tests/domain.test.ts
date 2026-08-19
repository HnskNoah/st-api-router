import { describe, it, expect } from 'vitest';
import {
    normalizeQuickAction,
    normalizeQuickActionPlacement,
    normalizeQuickActionsForPersist,
    quickActionDisplayName,
    resolveLogicalModelForAction,
} from '../src/domain/quick-action.js';
import { normalizeLogicalModels } from '../src/domain/vendor.js';

describe('domain/quick-action', () => {
    it('normalizeQuickAction fills defaults and caps', () => {
        const action = normalizeQuickAction({ id: 'a1', label: '  Switch A  ' });
        expect(action.id).toBe('a1');
        expect(action.name).toBe('');
        expect(action.preset).toBe('');
        expect(action.model).toBe('');
        expect(action.sequence).toBe(0);
        const withValues = normalizeQuickAction({ name: 'A', preset: 'p', model: 'm', sequence: 3 });
        expect(withValues.name).toBe('A');
        expect(withValues.preset).toBe('p');
        expect(withValues.model).toBe('m');
        expect(withValues.sequence).toBe(3);
        expect(normalizeQuickAction({ preset: 'x'.repeat(600) }).preset).toHaveLength(500);
        expect(normalizeQuickAction({ model: 'y'.repeat(600) }).model).toHaveLength(500);
    });

    it('normalizeQuickActionPlacement validates', () => {
        expect(normalizeQuickActionPlacement('leftSendForm')).toBe('leftSendForm');
        expect(normalizeQuickActionPlacement('rightSendForm')).toBe('rightSendForm');
        expect(normalizeQuickActionPlacement('qrButtons')).toBe('qrButtons');
        expect(normalizeQuickActionPlacement('disabled')).toBe('disabled');
        expect(normalizeQuickActionPlacement('bogus')).toBe('rightSendForm');
        expect(normalizeQuickActionPlacement(undefined)).toBe('rightSendForm');
    });

    it('quickActionDisplayName falls back to index-based name', () => {
        expect(quickActionDisplayName({ name: 'My QA' }, 0)).toBe('My QA');
        expect(quickActionDisplayName({ name: '' }, 2)).toBe('方案3');
    });

    it('normalizeQuickActionsForPersist fills blank names and resequences', () => {
        const out = normalizeQuickActionsForPersist([
            { id: 'a', name: '', preset: 'p1', model: '', sequence: 5 },
            { id: 'b', name: 'B', preset: '', model: 'm', sequence: 0 },
        ]);
        expect(out[0].name).toBe('方案1');
        expect(out[0].sequence).toBe(0);
        expect(out[1].name).toBe('B');
        expect(out[1].sequence).toBe(1);
    });
});

describe('domain/quick-action model resolution', () => {
    it('resolveLogicalModelForAction matches by id first, then exact name', () => {
        const logicalModels = normalizeLogicalModels([{ id: 'lm-1', name: 'DeepSeek R1' }]);
        expect(resolveLogicalModelForAction('lm-1', logicalModels)?.id).toBe('lm-1');
        expect(resolveLogicalModelForAction('  lm-1  ', logicalModels)?.id).toBe('lm-1');
        expect(resolveLogicalModelForAction('DeepSeek R1', logicalModels)?.id).toBe('lm-1');
    });

    it('resolveLogicalModelForAction does not match on case differences or partial names', () => {
        const logicalModels = normalizeLogicalModels([{ id: 'lm-1', name: 'DeepSeek R1' }]);
        expect(resolveLogicalModelForAction('deepseek r1', logicalModels)).toBeNull();
        expect(resolveLogicalModelForAction('unknown', logicalModels)).toBeNull();
        expect(resolveLogicalModelForAction('', logicalModels)).toBeNull();
        expect(resolveLogicalModelForAction('  ', logicalModels)).toBeNull();
    });
});
