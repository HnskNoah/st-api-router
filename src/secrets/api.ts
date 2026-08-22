// Secrets API 服务（宿主 /api/secrets/* 交互）

import { getRequestHeaders, eventSource, event_types, saveSettingsDebounced } from '@sillytavern/script';
import { SECRET_KEYS, secret_state } from '@sillytavern/scripts/secrets';
import { EMPTY_SECRET_LABEL, FORMATS } from '../constants.js';
import { runtimeState } from '../state.js';
import { normalizeText } from '../utils/text.js';
import { settings } from '../settings/access.js';
import { getSecretEntries } from './access.js';
import { fetchJsonWithTimeout, fetchWithTimeout } from '../fetch.js';
import { QUICK_API_SECRET_LABEL_PREFIX, clearableQuickApiSecretIds } from './clear.js';

export { QUICK_API_SECRET_LABEL_PREFIX, clearableQuickApiSecretIds };

export async function readAuthoritativeSecretState(): Promise<Record<string, any> | null> {
    try {
        const { response, data: state } = await fetchJsonWithTimeout('/api/secrets/read', {
            method: 'POST',
            headers: getRequestHeaders({ omitContentType: true }),
        }, 15000);
        if (!response.ok) return null;
        if (!state || typeof state !== 'object') return null;
        // 以 ST 的真实 secret 槽名（SECRET_KEYS 长名）刷新宿主缓存；FORMATS 里的短名
        // （custom/claude/makersuite）只是插件内部命名空间，写进 secret_state 是幽灵键。
        for (const key of Object.values(SECRET_KEYS)) {
            if (typeof key !== 'string' || !key) continue;
            secret_state[key] = Array.isArray(state[key]) ? state[key] : [];
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
    // 标签必须带清理前缀：writeSecretVerified 成功即代表服务端已落库且激活，
    // 但若后续流程部分失败（rotate 假失败重写等）留下的孤儿空占位也能被「一键清除」回收。
    const id = await writeSecretVerified(key, '', `${QUICK_API_SECRET_LABEL_PREFIX} ${EMPTY_SECRET_LABEL}`);
    if (!id) return '';
    settings().emptySecretIds[key] = id;
    saveSettingsDebounced();
    return id;
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

/** 只为拿到一个可用的 secret id：已有同值 secret 就复用其 id（不切换 active），没有才写一条新的。 */
export async function ensureSecretId(key: string, value: string, label: string): Promise<string> {
    const normalized = normalizeText(value);
    if (!normalized) return '';
    const match = await findMatchingSecret(key, normalized);
    if (match.entry) return match.entry.id;
    return await writeSecretVerified(key, normalized, label);
}

/** 删除指定 secret 条目。 */
export async function deleteSecretVerified(key: string, id: string): Promise<boolean> {
    if (!id) return false;
    try {
        const response = await fetchWithTimeout('/api/secrets/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ key, id }),
        }, 15000) as Response;
        return response.ok;
    } catch (error) {
        console.error('[QuickerApi] Secret delete failed:', key, error);
        return false;
    }
}

/** 一键清除插件写入的临时 secret：清 CUSTOM + DEEPSEEK 下 quicker-api: 前缀条目，各留一个空 active。 */
export async function clearQuickApiSecrets(): Promise<{ deleted: number }> {
    const state = await readAuthoritativeSecretState();
    const keys = [SECRET_KEYS.CUSTOM, SECRET_KEYS.DEEPSEEK];
    let deleted = 0;
    for (const key of keys) {
        const ids = clearableQuickApiSecretIds(Array.isArray(state?.[key]) ? state[key] : []);
        for (const id of ids) {
            if (await deleteSecretVerified(key, id)) deleted++;
        }
        await ensureEmptySecret(key);
    }
    await readAuthoritativeSecretState();
    return { deleted };
}
