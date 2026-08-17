import { describe, expect, it } from 'vitest';
import { isKeyUnused, isVendorUnused } from '../src/routing/ui-helpers';

describe('isKeyUnused', () => {
    it('returns false for enabled key with apiKey', () => {
        expect(isKeyUnused({ enabled: true, apiKey: 'sk-123' })).toBe(false);
    });

    it('returns true for disabled key', () => {
        expect(isKeyUnused({ enabled: false, apiKey: 'sk-123' })).toBe(true);
    });

    it('returns true for empty apiKey', () => {
        expect(isKeyUnused({ enabled: true, apiKey: '' })).toBe(true);
    });

    it('returns true for disabled and empty key', () => {
        expect(isKeyUnused({ enabled: false, apiKey: '' })).toBe(true);
    });
});

describe('isVendorUnused', () => {
    it('returns false for enabled vendor with usable key', () => {
        const vendor = { enabled: true };
        const entries = [{ vendorId: 'v1', enabled: true, apiKey: 'sk-123' }];
        expect(isVendorUnused(vendor, 'v1', entries)).toBe(false);
    });

    it('returns true for disabled vendor', () => {
        const vendor = { enabled: false };
        const entries = [{ vendorId: 'v1', enabled: true, apiKey: 'sk-123' }];
        expect(isVendorUnused(vendor, 'v1', entries)).toBe(true);
    });

    it('returns true for enabled vendor with no entries', () => {
        const vendor = { enabled: true };
        const entries: { vendorId: string; enabled: boolean; apiKey: string }[] = [];
        expect(isVendorUnused(vendor, 'v1', entries)).toBe(true);
    });

    it('returns true when all keys are disabled', () => {
        const vendor = { enabled: true };
        const entries = [{ vendorId: 'v1', enabled: false, apiKey: 'sk-123' }];
        expect(isVendorUnused(vendor, 'v1', entries)).toBe(true);
    });

    it('returns true when all keys are empty', () => {
        const vendor = { enabled: true };
        const entries = [{ vendorId: 'v1', enabled: true, apiKey: '' }];
        expect(isVendorUnused(vendor, 'v1', entries)).toBe(true);
    });

    it('ignores entries from other vendors', () => {
        const vendor = { enabled: true };
        const entries = [
            { vendorId: 'v2', enabled: true, apiKey: 'sk-123' },
            { vendorId: 'v1', enabled: false, apiKey: 'sk-123' },
        ];
        expect(isVendorUnused(vendor, 'v1', entries)).toBe(true);
    });
});