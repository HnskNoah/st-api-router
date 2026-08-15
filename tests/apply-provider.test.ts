import { describe, it, expect } from 'vitest';
import { clampContextLimit } from '../src/domain/context.js';

describe('apply-provider clampContextLimit', () => {
    it('clamps current context down to vendor max when current is positive', () => {
        expect(clampContextLimit(40000, 20000)).toBe(20000);
        expect(clampContextLimit(20000, 20000)).toBe(20000);
    });

    it('does not raise current context above vendor max', () => {
        expect(clampContextLimit(8000, 20000)).toBe(8000);
    });

    it('applies vendor max when current context is unset', () => {
        expect(clampContextLimit(0, 20000)).toBe(20000);
        expect(clampContextLimit(NaN, 20000)).toBe(20000);
    });

    it('leaves current context untouched when vendor max is not set', () => {
        expect(clampContextLimit(40000, 0)).toBe(40000);
        expect(clampContextLimit(40000, NaN)).toBe(40000);
    });
});
