// Vendor token 限制换算：
// ST 语义：openai_max_context = 总上下文预算，openai_max_tokens = 输出上限，输入预算 = 总上下文 - 输出。
// Vendor 提供三个可选上限（0 = 不限制）。只有当前设置超过上限时才需要钳制，不把低于上限的设置调高。

import { describe, expect, it } from 'vitest';
import { computeVendorTokenClamps } from '../src/domain/vendor.js';

describe('domain/vendor > computeVendorTokenClamps', () => {
    it('只有上下文上限时钳制总上下文，不动输出', () => {
        const result = computeVendorTokenClamps(
            { maxContext: 8000, maxInputTokens: 0, maxOutputTokens: 0 },
            { maxContext: 32000, maxOutputTokens: 2000 },
        );
        expect(result.maxContext).toBe(8000);
        expect(result.maxOutputTokens).toBeUndefined();
    });

    it('只有输出上限时，当前输出未超过上限则不调高', () => {
        const result = computeVendorTokenClamps(
            { maxContext: 0, maxInputTokens: 0, maxOutputTokens: 4096 },
            { maxContext: 32000, maxOutputTokens: 2000 },
        );
        expect(result.maxContext).toBeUndefined();
        expect(result.maxOutputTokens).toBeUndefined();
    });

    it('当前输出超过 Vendor 上限时钳制输出', () => {
        const result = computeVendorTokenClamps(
            { maxContext: 0, maxInputTokens: 0, maxOutputTokens: 4096 },
            { maxContext: 32000, maxOutputTokens: 5000 },
        );
        expect(result.maxContext).toBeUndefined();
        expect(result.maxOutputTokens).toBe(4096);
    });

    it('输入上限换算：总上下文 = max(输入上限 + 当前输出, 输入上限 + Vendor 输出上限)', () => {
        const result = computeVendorTokenClamps(
            { maxContext: 0, maxInputTokens: 16000, maxOutputTokens: 0 },
            { maxContext: 32000, maxOutputTokens: 3000 },
        );
        // 输入 16000 + 输出预算 3000 = 19000，钳制总上下文到 19000
        expect(result.maxContext).toBe(19000);
        expect(result.maxOutputTokens).toBeUndefined();
    });

    it('输入上限 + 输出上限同时设置：只钳制超限字段', () => {
        const result = computeVendorTokenClamps(
            { maxContext: 0, maxInputTokens: 12000, maxOutputTokens: 4000 },
            { maxContext: 32000, maxOutputTokens: 1000 },
        );
        expect(result.maxContext).toBe(16000);
        expect(result.maxOutputTokens).toBeUndefined();
    });

    it('上下文 + 输出同时设置时各自按超限钳制', () => {
        const result = computeVendorTokenClamps(
            { maxContext: 20000, maxInputTokens: 0, maxOutputTokens: 3000 },
            { maxContext: 32000, maxOutputTokens: 2000 },
        );
        expect(result.maxContext).toBe(20000);
        expect(result.maxOutputTokens).toBeUndefined();
    });

    it('全部未设置时返回空（不钳制）', () => {
        const result = computeVendorTokenClamps(
            { maxContext: 0, maxInputTokens: 0, maxOutputTokens: 0 },
            { maxContext: 32000, maxOutputTokens: 2000 },
        );
        expect(result.maxContext).toBeUndefined();
        expect(result.maxOutputTokens).toBeUndefined();
    });

    it('当前上下文未超过 Vendor 上限时不弹钳制（不调高）', () => {
        const result = computeVendorTokenClamps(
            { maxContext: 200000, maxInputTokens: 0, maxOutputTokens: 0 },
            { maxContext: 32000, maxOutputTokens: 2000 },
        );
        expect(result.maxContext).toBeUndefined();
        expect(result.maxOutputTokens).toBeUndefined();
    });

});
