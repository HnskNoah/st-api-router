// Profile 领域纯函数

import { normalizeText, sanitizeName } from '../utils/text.js';
import { normalizeModelList } from '../utils/model-list.js';
import { makeId } from '../utils/id.js';
import { normalizeFormat } from '../utils/format.js';
import { FORMATS } from '../constants.js';
import type { Profile, NativeImportCandidate } from '../types.js';

export function normalizeProfile(raw: Record<string, any> | undefined): Profile {
    const format = normalizeFormat(raw?.format);
    const model = String(raw?.model || '').slice(0, 500);
    const availableModels = format === 'openai' ? normalizeModelList(raw?.availableModels) : [];
    if (model && !availableModels.includes(model)) availableModels.unshift(model);
    return {
        id: normalizeText(raw?.id) || makeId(),
        name: sanitizeName(raw?.name) || 'API Profile',
        format,
        endpoint: String(raw?.endpoint || '').slice(0, 2048),
        model,
        availableModels,
        fetchedModels: format === 'openai' ? normalizeModelList(raw?.fetchedModels) : [],
        customized: format === 'openai'
            ? (Object.hasOwn(raw || {}, 'customized') ? Boolean(raw?.customized) : Boolean(raw?.fetchedModels?.length))
            : false,
        fetchedFromEndpoint: format === 'openai'
            ? String(raw?.fetchedFromEndpoint || (raw?.fetchedModels?.length ? raw?.endpoint : '') || '').slice(0, 2048)
            : '',
        includeBody: format === 'openai' ? String(raw?.includeBody || '').slice(0, 100000) : '',
        excludeBody: format === 'openai' ? String(raw?.excludeBody || '').slice(0, 100000) : '',
        includeHeaders: format === 'openai' ? String(raw?.includeHeaders || '').slice(0, 100000) : '',
        secretId: String(raw?.secretId || ''),
        proxyPreset: String(raw?.proxyPreset || ''),
        needsSecret: Boolean(raw?.needsSecret),
        nativeImportFingerprint: String(raw?.nativeImportFingerprint || '').slice(0, 5000),
        updatedAt: String(raw?.updatedAt || ''),
    };
}

export function uniqueName(baseName: unknown, existing: Pick<Profile, 'id' | 'name'>[], ignoredId: string | null = null): string {
    const base = sanitizeName(baseName) || 'API Profile';
    const used = new Set(existing.filter(profile => profile.id !== ignoredId).map(profile => profile.name.toLocaleLowerCase()));
    if (!used.has(base.toLocaleLowerCase())) return base;
    let index = 2;
    while (used.has(`${base} (${index})`.toLocaleLowerCase())) index++;
    return `${base} (${index})`;
}

export function importIdentity(format: string, endpoint: unknown, credentialIdentity: string): string {
    return `${format}|${normalizeText(endpoint).toLocaleLowerCase()}|${credentialIdentity}`;
}

export function nativeImportFingerprint(candidate: Pick<NativeImportCandidate, 'sourceRef' | 'sourceLabel' | 'sourceSecretKey' | 'sourceSecretId' | 'proxyPreset'>, format: string, endpoint: unknown): string {
    const sourceRef = normalizeText(candidate.sourceRef || candidate.sourceLabel).toLocaleLowerCase();
    const credentialRef = candidate.sourceSecretKey && candidate.sourceSecretId
        ? `secret:${candidate.sourceSecretKey}:${candidate.sourceSecretId}`
        : (candidate.proxyPreset ? `proxy:${normalizeText(candidate.proxyPreset).toLocaleLowerCase()}` : 'no-source-credential');
    return `${sourceRef}|${format}|${normalizeText(endpoint).toLocaleLowerCase()}|${credentialRef}`.slice(0, 5000);
}

export function formatLabel(format: string): string {
    return FORMATS[normalizeFormat(format)]?.label ?? '';
}
