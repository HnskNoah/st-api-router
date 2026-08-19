import { describe, it, expect } from 'vitest';
import { EMPTY_CUSTOM_CONNECTION } from '../src/constants.js';

describe('EMPTY_CUSTOM_CONNECTION：启动空占位连接', () => {
    it('source 固定为 custom（切断 RA_autoconnect 的 custom/deepseek 分支）', () => {
        expect(EMPTY_CUSTOM_CONNECTION.chat_completion_source).toBe('custom');
    });

    it("custom_url 为空 → isValidUrl('') 为 false，auto_connect 无 target 可连", () => {
        expect(EMPTY_CUSTOM_CONNECTION.custom_url).toBe('');
        // 恒为空地址，保证不触发「自动连接上次服务器」
        expect(EMPTY_CUSTOM_CONNECTION.custom_url.trim()).toHaveLength(0);
    });

    it('custom_model / custom_api_format 为合法占位（不影响拦截模式改写）', () => {
        expect(EMPTY_CUSTOM_CONNECTION.custom_model).toBe('');
        expect(EMPTY_CUSTOM_CONNECTION.custom_api_format).toBe('openai_compat');
    });
});
