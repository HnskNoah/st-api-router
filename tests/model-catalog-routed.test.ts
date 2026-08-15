import { describe, it, expect } from 'vitest';
import { isRoutedModel } from '../src/domain/model-catalog.js';
import { migrateProvidersToVendorModel, normalizeLogicalModels } from '../src/domain/vendor.js';
import { normalizeProviders } from '../src/domain/provider.js';

function sampleVendors() {
    const migrated = migrateProvidersToVendorModel(normalizeProviders([
        { name: 'A', endpoint: 'https://a/v1', keys: [{ label: 'A1', fetchedModels: ['[希希2]grok-4.5'] }] },
    ]));
    return migrated.vendors;
}

describe('model-catalog isRoutedModel', () => {
    it('matches model names aggregated from legacy providers', () => {
        const providers = normalizeProviders([
            { name: 'P', endpoint: 'https://p/v1', keys: [{ label: 'K', fetchedModels: ['legacy-model'] }] },
        ]);
        expect(isRoutedModel(providers, [], [], 'legacy-model')).toBe(true);
        expect(isRoutedModel(providers, [], [], 'other')).toBe(false);
    });

    it('matches real model names from vendor mappings', () => {
        const vendors = sampleVendors();
        const logicalModels = normalizeLogicalModels([{ id: 'lm-[希希2]grok-4.5', name: '[希希2]grok-4.5' }]);
        expect(isRoutedModel([], vendors, logicalModels, '[希希2]grok-4.5')).toBe(true);
    });

    it('matches logical model ids even when no vendor carries the raw name', () => {
        const vendors = sampleVendors();
        const logicalModels = normalizeLogicalModels([{ id: 'lm-grok-4.5', name: 'Grok 4.5' }]);
        expect(isRoutedModel([], vendors, logicalModels, 'lm-grok-4.5')).toBe(true);
    });

    it('returns false for empty inputs and unknown models', () => {
        expect(isRoutedModel([], [], [], '')).toBe(false);
        expect(isRoutedModel([], [], [], 'unknown')).toBe(false);
    });
});
