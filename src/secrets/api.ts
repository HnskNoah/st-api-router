// Secrets API 服务（宿主 /api/secrets/* 交互）

import { getRequestHeaders, eventSource, event_types, saveSettingsDebounced } from '@sillytavern/script';
import { secret_state } from '@sillytavern/scripts/secrets';
import { EMPTY_SECRET_LABEL, FORMATS } from '../constants.js';
import { runtimeState } from '../state.js';
import { normalizeText } from '../utils/text.js';
import { settings } from '../settings/access.js';
import { getSecretEntries } from './access.js';
import { fetchJsonWithTimeout, fetchWithTimeout } from '../fetch.js';

export async function readAuthoritativeSecretState(): Promise<Record<string, any> | null> {
    try {
        const { response, data: state } = await fetchJsonWithTimeout('/api/secrets/read', {
            method: 'POST',
            headers: getRequestHeaders({ omitContentType: true }),
        }, 15000);
        if (!response.ok) return null;
        if (!state || typeof state !== 'object') return null;
        for (const config of Object.values(FORMATS)) {
            secret_state[config.secretKey] = Array.isArray(state[config.secretKey]) ? state[config.secretKey] : [];
        }
        return state;
    } catch (error) {
        console.error('[QuickerApi] Authoritative secret read failed:', error);
        return null;
    }
}

export async function writeSecretVerified(key: string, value: string, label: string): Promise<string> {
    try {
        const { response, data } = await fetchJsonWithTimeout('/api/secrets/write', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ key, value, label }),
        }, 15000);
        if (!response.ok) return '';
        const id = normalizeText(data?.id);
        const state = id ? await readAuthoritativeSecretState() : null;
        if (!id || !state?.[key]?.some(entry => entry.id === id && entry.active)) return '';
        const input = Object.values(FORMATS).find(config => config.secretKey === key)?.keyInput;
        if (input) $(input).val('').trigger('input');
        void eventSource.emit(event_types.SECRET_WRITTEN, key).catch(error =>
            console.warn('[QuickerApi] SECRET_WRITTEN listener failed:', error));
        return id;
    } catch (error) {
        console.error('[QuickerApi] Secret write failed:', error);
        return '';
    }
}

export async function rotateSecretVerified(key: string, id: string): Promise<boolean> {
    if (!id) return false;
    try {
        const response = await fetchWithTimeout('/api/secrets/rotate', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ key, id }),
        }, 15000) as Response;
        if (!response.ok) return false;
        const state = await readAuthoritativeSecretState();
        return Boolean(state && Array.isArray(state[key]) && state[key].some(entry => entry.id === id && entry.active));
    } catch (error) {
        console.error('[QuickerApi] Secret rotation failed:', error);
        return false;
    }
}

export async function ensureEmptySecret(key: string): Promise<string> {
    const storedId = String(settings().emptySecretIds[key] || '');
    if (storedId && await rotateSecretVerified(key, storedId)) return storedId;
    const id = await writeSecretVerified(key, '', EMPTY_SECRET_LABEL);
    const state = id ? await readAuthoritativeSecretState() : null;
    if (id && state?.[key]?.some(entry => entry.id === id && entry.active)) {
        settings().emptySecretIds[key] = id;
        saveSettingsDebounced();
        return id;
    }
    return '';
}

export async function findSecretBounded(key: string, id: string): Promise<string | null> {
    if (runtimeState.extensionDisabled || runtimeState.teardownPending) return null;
    try {
        const { response, data } = await fetchJsonWithTimeout('/api/secrets/find', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ key, id }),
        }, 15000);
        if (!response.ok) return null;
        return data?.value ?? null;
    } catch (error) {
        console.warn('[QuickerApi] Secret lookup failed or timed out:', key, error);
        return null;
    }
}

export async function findMatchingSecret(key: string, value: string): Promise<{ entry: { id: string } | null; exposureAvailable: boolean }> {
    let readable = false;
    for (const entry of getSecretEntries(key)) {
        const existing = await findSecretBounded(key, entry.id);
        if (existing === null) continue;
        readable = true;
        if (existing === value) return { entry: { id: entry.id }, exposureAvailable: true };
    }
    return { entry: null, exposureAvailable: readable };
}

export async function ensureSecret(key: string, value: string, label: string): Promise<{ id: string; reused: boolean; exposureAvailable: boolean }> {
    const normalized = normalizeText(value);
    if (!normalized) return { id: '', reused: false, exposureAvailable: true };
    const match = await findMatchingSecret(key, normalized);
    if (match.entry) {
        const activated = await rotateSecretVerified(key, match.entry.id);
        return { id: activated ? match.entry.id : '', reused: true, exposureAvailable: true };
    }
    const id = await writeSecretVerified(key, normalized, label);
    const state = id ? await readAuthoritativeSecretState() : null;
    const verified = Boolean(id && state?.[key]?.some(entry => entry.id === id && entry.active));
    return { id: verified ? id : '', reused: false, exposureAvailable: match.exposureAvailable };
}
