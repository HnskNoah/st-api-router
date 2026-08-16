import { describe, it, expect } from 'vitest';
import {
    BLOCKED_SOURCE_PRESET_TRANSITION,
    BLOCKED_SOURCE_SAFETY,
    isGenerationBlockedByGuard,
} from '../src/domain/generation-guard.js';

describe('guard 阻断哨兵：isGenerationBlockedByGuard', () => {
    it('识别预设切换阻断哨兵', () => {
        expect(isGenerationBlockedByGuard(BLOCKED_SOURCE_PRESET_TRANSITION)).toBe(true);
    });

    it('识别密钥安全阻断哨兵', () => {
        expect(isGenerationBlockedByGuard(BLOCKED_SOURCE_SAFETY)).toBe(true);
    });

    it('普通 source 不视为阻断', () => {
        expect(isGenerationBlockedByGuard('openai')).toBe(false);
        expect(isGenerationBlockedByGuard('deepseek')).toBe(false);
        expect(isGenerationBlockedByGuard('custom')).toBe(false);
    });

    it('空值 / undefined 不视为阻断', () => {
        expect(isGenerationBlockedByGuard(undefined)).toBe(false);
        expect(isGenerationBlockedByGuard(null)).toBe(false);
        expect(isGenerationBlockedByGuard('')).toBe(false);
    });
});
