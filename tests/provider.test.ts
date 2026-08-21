import { describe, it, expect } from 'vitest';
import { normalizeRoutingSettings } from '../src/constants.js';

describe('routing settings', () => {
    it('normalizeRoutingSettings fills defaults for missing/invalid values', () => {
        expect(normalizeRoutingSettings(undefined)).toEqual({ enabled: false, stickyCount: 0, failThreshold: 3, cooldownSeconds: 300, autoRetryCount: 0 });
        expect(normalizeRoutingSettings({ enabled: true, stickySeconds: '30', failThreshold: -1, cooldownSeconds: 0 }))
            .toEqual({ enabled: true, stickyCount: 1, failThreshold: 3, cooldownSeconds: 300, autoRetryCount: 0 });
        expect(normalizeRoutingSettings({ stickySeconds: 1.9, failThreshold: 2.1, cooldownSeconds: 5.7 }))
            .toEqual({ enabled: false, stickyCount: 1, failThreshold: 2, cooldownSeconds: 5, autoRetryCount: 0 });
        expect(normalizeRoutingSettings({ stickyCount: 3, failThreshold: 5, autoRetryCount: 4 }))
            .toEqual({ enabled: false, stickyCount: 3, failThreshold: 5, cooldownSeconds: 300, autoRetryCount: 4 });
    });
});
