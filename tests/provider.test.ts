import { describe, it, expect } from 'vitest';
import { normalizeProvider, normalizeProviders, normalizeProviderFormat, resetRoutingRuntimeState, providerFromProfile } from '../src/domain/provider.js';
import { normalizeRoutingSettings } from '../src/domain/routing.js';
import type { Provider } from '../src/types.js';

describe('domain/provider', () => {
    it('normalizeProviderFormat validates formats', () => {
        expect(normalizeProviderFormat('custom')).toBe('custom');
        expect(normalizeProviderFormat('deepseek')).toBe('deepseek');
        expect(normalizeProviderFormat('custom-responses')).toBe('custom'); // 已移除的格式回退 custom
        expect(normalizeProviderFormat('openai')).toBe('custom');
        expect(normalizeProviderFormat('')).toBe('custom');
        expect(normalizeProviderFormat(undefined)).toBe('custom');
    });

    it('normalizeKey fills defaults and caps values', () => {
        const key = normalizeProvider({ keys: [{ label: '  A  ' }] }).keys[0];
        expect(key.label).toBe('A');
        expect(key.rpm).toBe(3);
        expect(key.weight).toBe(1);
        expect(key.enabled).toBe(true);
        expect(key.window).toEqual([]);
        expect(key.circuits).toEqual({});
        expect(key.failStreakByModel).toEqual({});
        expect(key.id.startsWith('key-')).toBe(true);
        expect(normalizeProvider({ keys: [{ apiKey: 'x'.repeat(3000) }] }).keys[0].apiKey).toHaveLength(2048);
        expect(normalizeProvider({ keys: [{ label: 'B', enabled: false }] }).keys[0].enabled).toBe(false);
    });

    it('normalizeProvider defaults name and id', () => {
        const p = normalizeProvider({});
        expect(p.name).toBe('Provider');
        expect(p.id.startsWith('provider-')).toBe(true);
        expect(p.format).toBe('custom');
        expect(p.keys).toHaveLength(1);
    });

    it('旧平铺形状迁移进 keys[0]，rpm 默认 3', () => {
        const providers = normalizeProviders([{
            name: 'L', endpoint: 'x', apiKey: 'lk', fetchedModels: ['m1'], rpm: 5, weight: 3,
        }]);
        expect(providers[0].keys).toHaveLength(1);
        expect(providers[0].keys[0].apiKey).toBe('lk');
        expect(providers[0].keys[0].rpm).toBe(5);
        expect(providers[0].keys[0].fetchedModels).toEqual(['m1']);
        expect(normalizeProvider({ name: 'N' }).keys[0].rpm).toBe(3); // 默认 3
    });

    it('normalize 保留运行时状态（编辑器保存不丢熔断/窗口）；载入重置走 resetRoutingRuntimeState', () => {
        const p = normalizeProvider({
            name: 'P',
            keys: [{ label: 'A', window: [1, 2], circuits: { m: 999 }, failStreakByModel: { m: 2 }, lastError: 'x' }],
        });
        expect(p.keys[0].window).toEqual([1, 2]);
        expect(p.keys[0].circuits).toEqual({ m: 999 });
        expect(p.keys[0].failStreakByModel).toEqual({ m: 2 });
        expect(p.keys[0].lastError).toBe('x');
        resetRoutingRuntimeState([p]);
        expect(p.keys[0].window).toEqual([]);
        expect(p.keys[0].circuits).toEqual({});
        expect(p.keys[0].failStreakByModel).toEqual({});
        expect(p.keys[0].lastError).toBe('');
    });

    it('旧 Profile 迁移：id 保留、模型记入唯一 key 的 fetchedModels', () => {
        const profile = {
            id: 'p1', name: '旧配置', format: 'openai', endpoint: 'https://old/v1',
            model: 'gpt-4o', availableModels: ['gpt-4o', 'gpt-4o-mini'],
        };
        const provider = providerFromProfile(profile);
        expect(provider.id).toBe('p1');
        expect(provider.format).toBe('custom');
        expect(provider.keys).toHaveLength(1);
        expect(provider.keys[0].fetchedModels).toEqual(['gpt-4o', 'gpt-4o-mini']);
        expect(provider.keys[0].apiKey).toBe('');
    });

    it('旧 anthropic/gemini Profile 的 proxyPreset.url 作 endpoint', () => {
        const provider = providerFromProfile({ id: 'p2', format: 'anthropic', proxyPreset: { url: 'https://proxy/v1' }, model: 'claude' });
        expect(provider.endpoint).toBe('https://proxy/v1');
    });
});

describe('domain/routing settings', () => {
    it('normalizeRoutingSettings fills defaults for missing/invalid values', () => {
        expect(normalizeRoutingSettings(undefined)).toEqual({ enabled: false, stickySeconds: 600, failThreshold: 3, cooldownSeconds: 60 });
        expect(normalizeRoutingSettings({ enabled: true, stickySeconds: '30', failThreshold: -1, cooldownSeconds: 0 }))
            .toEqual({ enabled: true, stickySeconds: 30, failThreshold: 3, cooldownSeconds: 60 });
        expect(normalizeRoutingSettings({ stickySeconds: 1.9, failThreshold: 2.1, cooldownSeconds: 5.7 }))
            .toEqual({ enabled: false, stickySeconds: 1, failThreshold: 2, cooldownSeconds: 5 });
    });
});
