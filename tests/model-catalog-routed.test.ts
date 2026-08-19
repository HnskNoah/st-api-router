import { describe, it, expect } from 'vitest';
import { isRoutedModel, normalizeGroup, normalizeLogicalModels } from '../src/domain/vendor.js';

function sampleGroups() {
    return [normalizeGroup({
        entries: [{
            vendorId: 'v1',
            apiKey: 'k1',
            label: 'K1',
            fetchedModels: ['[希希2]grok-4.5'],
            mappings: [{ id: 'm1', realModel: '[希希2]grok-4.5', logicalModelId: 'lm-grok-4.5' }],
        }],
    })];
}

describe('vendor isRoutedModel', () => {
    it('matches real model names from Key-level mappings', () => {
        const groups = sampleGroups();
        const logicalModels = normalizeLogicalModels([{ id: 'lm-grok-4.5', name: 'Grok 4.5' }]);
        expect(isRoutedModel(groups, logicalModels, '[希希2]grok-4.5')).toBe(true);
    });

    it('matches logical model ids even when no Key carries the raw name', () => {
        const groups = sampleGroups();
        const logicalModels = normalizeLogicalModels([{ id: 'lm-grok-4.5', name: 'Grok 4.5' }]);
        expect(isRoutedModel(groups, logicalModels, 'lm-grok-4.5')).toBe(true);
    });

    it('returns false for empty inputs and unknown models', () => {
        const logicalModels = normalizeLogicalModels([{ id: 'lm-1', name: 'L' }]);
        expect(isRoutedModel([], [], '')).toBe(false);
        expect(isRoutedModel([], [], 'unknown')).toBe(false);
        expect(isRoutedModel(sampleGroups(), logicalModels, 'not-mapped')).toBe(false);
    });
});
