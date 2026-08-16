import { describe, it, expect } from 'vitest';
import { patchGenerateData } from '../src/routing/patch-generate-data.js';
import type { GroupRouteUnit } from '../src/domain/group-routing.js';
import type { GroupEntry, Vendor, VendorModelMapping } from '../src/types.js';

function vendor(overrides: Partial<Vendor> = {}): Vendor {
    return {
        id: 'v1',
        name: 'TestVendor',
        format: 'custom',
        endpoint: 'https://example.com/v1',
        rpm: 0,
        maxContext: 0,
        maxInputTokens: 0,
        maxOutputTokens: 0,
        weight: 1,
        enabled: true,
        disabledReason: '',
        window: [],
        failStreak: 0,
        successes: 0,
        failures: 0,
        lastError: '',
        updatedAt: '',
        ...overrides,
    };
}

function entry(overrides: Partial<GroupEntry> = {}): GroupEntry {
    return {
        id: 'k1',
        vendorId: 'v1',
        apiKey: 'sk-test-123',
        label: 'A',
        enabled: true,
        fetchedModels: [],
        mappings: [],
        ...overrides,
    };
}

function mapping(overrides: Partial<VendorModelMapping> = {}): VendorModelMapping {
    return { id: 'm1', realModel: 'gpt-4o', logicalModelId: 'lm1', ...overrides };
}

function unit(overrides: Partial<GroupRouteUnit> = {}): GroupRouteUnit {
    return {
        vendor: vendor(),
        entry: entry(),
        mapping: mapping(),
        realModel: 'gpt-4o',
        ...overrides,
    };
}

describe('patchGenerateData：拦截模式连接字段写入', () => {
    it('custom 格式 → source=openai + reverse_proxy + proxy_password + model', () => {
        const gd: Record<string, any> = { chat_completion_source: 'custom', custom_url: 'x' };
        patchGenerateData(gd, unit());
        expect(gd.chat_completion_source).toBe('openai');
        expect(gd.reverse_proxy).toBe('https://example.com/v1');
        expect(gd.proxy_password).toBe('sk-test-123');
        expect(gd.model).toBe('gpt-4o');
    });

    it('deepseek 格式 → source=deepseek，其余字段相同', () => {
        const gd: Record<string, any> = {};
        patchGenerateData(gd, unit({ vendor: vendor({ format: 'deepseek' }) }));
        expect(gd.chat_completion_source).toBe('deepseek');
        expect(gd.reverse_proxy).toBe('https://example.com/v1');
        expect(gd.proxy_password).toBe('sk-test-123');
        expect(gd.model).toBe('gpt-4o');
    });

    it('未指定格式默认走 custom（openai）分支', () => {
        const gd: Record<string, any> = {};
        patchGenerateData(gd, unit({ vendor: vendor({ format: undefined as unknown as Vendor['format'] }) }));
        expect(gd.chat_completion_source).toBe('openai');
    });

    it('空 key 也写入空字符串（不抛错，不读 secrets）', () => {
        const gd: Record<string, any> = {};
        patchGenerateData(gd, unit({ entry: entry({ apiKey: '' }) }));
        expect(gd.proxy_password).toBe('');
    });

    it('endpoint 首尾空白被 trim', () => {
        const gd: Record<string, any> = {};
        patchGenerateData(gd, unit({ vendor: vendor({ endpoint: '  https://example.com/v1  ' }) }));
        expect(gd.reverse_proxy).toBe('https://example.com/v1');
    });

    it('不写入 secrets 相关字段（无 secret_id / custom_url 副作用）', () => {
        const gd: Record<string, any> = { secret_id: 'old', custom_url: 'old-url' };
        patchGenerateData(gd, unit());
        // 不触碰 secret_id 与 custom_url——ST 后端只认 reverse_proxy + proxy_password
        expect(gd.secret_id).toBe('old');
        expect(gd.custom_url).toBe('old-url');
    });

    it('覆盖旧连接字段（同一对象多次写入）', () => {
        const gd: Record<string, any> = {};
        patchGenerateData(gd, unit());
        patchGenerateData(gd, unit({ realModel: 'gpt-4o-mini', entry: entry({ apiKey: 'sk-new' }) }));
        expect(gd.model).toBe('gpt-4o-mini');
        expect(gd.proxy_password).toBe('sk-new');
    });
});
