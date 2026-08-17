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
        secretId: 'sid-1',
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
    it('custom 格式 → source=custom + custom_url + secret_id + model', () => {
        const gd: Record<string, any> = { chat_completion_source: 'openai', reverse_proxy: 'x', proxy_password: 'y' };
        patchGenerateData(gd, unit());
        expect(gd.chat_completion_source).toBe('custom');
        expect(gd.custom_url).toBe('https://example.com/v1');
        expect(gd.secret_id).toBe('sid-1');
        expect(gd.model).toBe('gpt-4o');
    });

    it('custom 写入逻辑模型透传的 include/exclude/headers', () => {
        const gd: Record<string, any> = {};
        patchGenerateData(gd, unit(), { includeBody: 'top_k: 20', excludeBody: 'stop', includeHeaders: 'X-A: b' });
        expect(gd.custom_include_body).toBe('top_k: 20');
        expect(gd.custom_exclude_body).toBe('stop');
        expect(gd.custom_include_headers).toBe('X-A: b');
    });

    it('custom 无附加参数时写空字符串', () => {
        const gd: Record<string, any> = {};
        patchGenerateData(gd, unit());
        expect(gd.custom_include_body).toBe('');
        expect(gd.custom_exclude_body).toBe('');
        expect(gd.custom_include_headers).toBe('');
    });

    it('custom 空 secretId 写空字符串', () => {
        const gd: Record<string, any> = {};
        patchGenerateData(gd, unit({ entry: entry({ secretId: '' }) }));
        expect(gd.secret_id).toBe('');
    });

    it('deepseek 格式 → source=deepseek + reverse_proxy + proxy_password，不写 custom 参数', () => {
        const gd: Record<string, any> = {};
        patchGenerateData(gd, unit({ vendor: vendor({ format: 'deepseek' }) }));
        expect(gd.chat_completion_source).toBe('deepseek');
        expect(gd.reverse_proxy).toBe('https://example.com/v1');
        expect(gd.proxy_password).toBe('sk-test-123');
        expect(gd.model).toBe('gpt-4o');
        expect(gd.custom_include_body).toBeUndefined();
        expect(gd.secret_id).toBeUndefined();
    });

    it('custom endpoint 首尾空白被 trim 后写 custom_url', () => {
        const gd: Record<string, any> = {};
        patchGenerateData(gd, unit({ vendor: vendor({ endpoint: '  https://example.com/v1  ' }) }));
        expect(gd.custom_url).toBe('https://example.com/v1');
    });

    it('覆盖旧连接字段（同一对象多次写入）', () => {
        const gd: Record<string, any> = {};
        patchGenerateData(gd, unit());
        patchGenerateData(gd, unit({ realModel: 'gpt-4o-mini', entry: entry({ secretId: 'sid-2' }) }));
        expect(gd.model).toBe('gpt-4o-mini');
        expect(gd.secret_id).toBe('sid-2');
    });
});
