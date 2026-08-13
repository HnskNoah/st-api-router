import { describe, it, expect } from 'vitest';
import { aggregateModels, keyUnits, modelRegistry, modelsGroupedByKey, unitId, unitsCarryingModel } from '../src/domain/model-catalog.js';
import { normalizeProviders } from '../src/domain/provider.js';

function sample() {
    return normalizeProviders([
        {
            name: '中转A', endpoint: 'https://a/v1',
            keys: [
                { label: 'K1', fetchedModels: ['gpt-4o', 'claude'] },
                { label: 'K2', fetchedModels: ['gpt-4o', 'gemini'] },
            ],
        },
        { name: 'B', endpoint: 'https://b/v1', keys: [{ label: 'K3', fetchedModels: ['claude'] }] },
    ]);
}

describe('domain/model-catalog', () => {
    it('keyUnits 展平全部单元并生成稳定 unitId', () => {
        const units = keyUnits(sample());
        expect(units).toHaveLength(3);
        expect(unitId(units[0])).toBe(`${units[0].provider.id}::${units[0].key.id}`);
    });

    it('aggregateModels 并集去重', () => {
        expect(aggregateModels(sample())).toEqual(['gpt-4o', 'claude', 'gemini']);
    });

    it('modelRegistry：模型记录自己的承载供应商', () => {
        const registry = modelRegistry(sample());
        const gpt = registry.find(entry => entry.model === 'gpt-4o')!;
        expect(gpt.units).toHaveLength(2); // K1 + K2
        const claude = registry.find(entry => entry.model === 'claude')!;
        expect(claude.units).toHaveLength(2); // K1 + K3（跨供应商）
        for (const entry of registry) {
            for (const unit of entry.units) {
                expect(unit.key.fetchedModels).toContain(entry.model);
            }
        }
    });

    it('unitsCarryingModel 与分组视图', () => {
        expect(unitsCarryingModel(sample(), 'gemini')).toHaveLength(1);
        const groups = modelsGroupedByKey(sample());
        expect(groups).toHaveLength(3);
        expect(groups.find(g => g.key.label === 'K2')?.models).toEqual(['gpt-4o', 'gemini']);
    });

    it('空 providers 返回空集合', () => {
        expect(keyUnits([])).toEqual([]);
        expect(aggregateModels([])).toEqual([]);
        expect(modelRegistry([])).toEqual([]);
    });
});
