import { describe, it, expect } from 'vitest';
import { normalizeProfile, uniqueName, importIdentity, nativeImportFingerprint } from '../src/domain/profile.js';
import { normalizeQuickAction, normalizeQuickActionPlacement, quickActionDisplayName } from '../src/domain/quick-action.js';
import { editorHasUnsavedChanges, proxyModeForFormat } from '../src/domain/status.js';
import type { Profile } from '../src/types.js';

describe('domain/profile', () => {
    it('normalizeProfile normalizes all fields', () => {
        const p = normalizeProfile({
            id: '  id-1  ',
            name: '  My Profile\u0000',
            format: 'anthropic',
            endpoint: '  https://x  ',
            model: '  claude-3 ',
            secretId: 's1',
            needsSecret: 1,
            updatedAt: '2024',
        });
        expect(p.id).toBe('id-1');
        expect(p.name).toBe('My Profile');
        expect(p.format).toBe('anthropic');
        expect(p.endpoint).toBe('  https://x  ');
        expect(p.model).toBe('  claude-3 ');
        expect(p.secretId).toBe('s1');
        expect(p.needsSecret).toBe(true);
        // non-openai formats drop model lists
        // model is always unshifted into availableModels (faithful to original)
        expect(p.availableModels).toEqual(['  claude-3 ']);
        expect(p.fetchedModels).toEqual([]);
        expect(p.customized).toBe(false);
    });

    it('normalizeProfile defaults name and id', () => {
        const p = normalizeProfile({});
        expect(p.name).toBe('API Profile');
        expect(p.id.startsWith('profile-')).toBe(true);
        expect(p.format).toBe('openai');
    });

    it('normalizeProfile for openai keeps model lists and custom flags', () => {
        const p = normalizeProfile({
            format: 'openai',
            model: 'm2',
            availableModels: [' m1 ', 'm2'],
            fetchedModels: ['m2', 'm3', 'm3'],
            customized: true,
            fetchedFromEndpoint: 'https://x/v1',
        });
        expect(p.availableModels).toEqual(['m1', 'm2']);
        expect(p.fetchedModels).toEqual(['m2', 'm3']);
        expect(p.customized).toBe(true);
        expect(p.fetchedFromEndpoint).toBe('https://x/v1');
    });

    it('normalizeProfile infers customized from fetchedModels when absent', () => {
        expect(normalizeProfile({ format: 'openai', fetchedModels: ['a'] }).customized).toBe(true);
        expect(normalizeProfile({ format: 'openai' }).customized).toBe(false);
    });

    it('normalizeProfile caps long values', () => {
        const p = normalizeProfile({ format: 'openai', endpoint: 'x'.repeat(5000), model: 'y'.repeat(1000), includeBody: 'z'.repeat(200000) });
        expect(p.endpoint).toHaveLength(2048);
        expect(p.model).toHaveLength(500);
        expect(p.includeBody).toHaveLength(100000);
    });

    it('uniqueName disambiguates case-insensitively', () => {
        const existing: Pick<Profile, 'id' | 'name'>[] = [
            { id: '1', name: 'Test' },
            { id: '2', name: 'test (2)' },
        ];
        expect(uniqueName('Test', existing)).toBe('Test (3)');
        expect(uniqueName('Other', existing)).toBe('Other');
        expect(uniqueName('', existing)).toBe('API Profile');
        expect(uniqueName('Test', existing, '1')).toBe('Test');
    });

    it('importIdentity builds pipe-joined key', () => {
        expect(importIdentity('openai', '  HTTPS://X  ', 'value:key')).toBe('openai|https://x|value:key');
    });

    it('nativeImportFingerprint distinguishes credential sources', () => {
        const base = { sourceRef: 'Ref', sourceLabel: '', sourceSecretKey: '', sourceSecretId: '', proxyPreset: '' };
        expect(nativeImportFingerprint(base, 'openai', 'https://x')).toBe('ref|openai|https://x|no-source-credential');
        expect(nativeImportFingerprint({ ...base, sourceSecretKey: 'custom', sourceSecretId: 's1' }, 'openai', 'https://x'))
            .toBe('ref|openai|https://x|secret:custom:s1');
        expect(nativeImportFingerprint({ ...base, proxyPreset: '  P1  ' }, 'anthropic', 'https://y'))
            .toBe('ref|anthropic|https://y|proxy:p1');
    });
});

describe('domain/quick-action', () => {
    it('normalizeQuickAction fills defaults and caps', () => {
        const a = normalizeQuickAction({ id: ' q1 ', name: '  N ', preset: 'p'.repeat(600), sequence: '3' });
        expect(a.id).toBe('q1');
        expect(a.name).toBe('N');
        expect(a.preset).toHaveLength(500);
        expect(a.sequence).toBe(3);
        const b = normalizeQuickAction(undefined, 4);
        expect(b.id.startsWith('quick-action-')).toBe(true);
        expect(b.sequence).toBe(4);
    });

    it('normalizeQuickActionPlacement validates', () => {
        expect(normalizeQuickActionPlacement('qrButtons')).toBe('qrButtons');
        expect(normalizeQuickActionPlacement('bogus')).toBe('rightSendForm');
        expect(normalizeQuickActionPlacement('bogus', 'disabled')).toBe('disabled');
    });

    it('quickActionDisplayName falls back to index name', () => {
        expect(quickActionDisplayName({ name: ' 甲 ' }, 0)).toBe('甲');
        expect(quickActionDisplayName({ name: '' }, 2)).toBe('方案3');
        expect(quickActionDisplayName({ name: '\u0000' }, 0)).toBe('方案1');
    });
});

describe('domain/status', () => {
    const profile = normalizeProfile({ id: '1', format: 'openai', endpoint: 'https://x', model: 'm' });

    it('editorHasUnsavedChanges detects all change types', () => {
        const base = { format: 'openai', url: 'https://x', model: 'm', modelBaseline: 'm', keyValue: '' };
        expect(editorHasUnsavedChanges(profile, base)).toBe(false);
        expect(editorHasUnsavedChanges(profile, { ...base, format: 'anthropic' })).toBe(true);
        expect(editorHasUnsavedChanges(profile, { ...base, url: ' https://y ' })).toBe(true);
        expect(editorHasUnsavedChanges(profile, { ...base, model: 'n' })).toBe(true);
        expect(editorHasUnsavedChanges(profile, { ...base, keyValue: 'secret' })).toBe(true);
        expect(editorHasUnsavedChanges(null, base)).toBe(false);
    });

    it('proxyModeForFormat only for non-openai with endpoint', () => {
        expect(proxyModeForFormat('openai', 'https://x')).toBe(false);
        expect(proxyModeForFormat('anthropic', 'https://x')).toBe(true);
        expect(proxyModeForFormat('anthropic', '')).toBe(false);
    });
});
