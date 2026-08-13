// 模型获取：前端 /models 优先，后端 status 兜底（拆解自 fetchModelsForProfile）

import { getRequestHeaders, saveSettingsDebounced } from '@sillytavern/script';
import { chat_completion_sources } from '@sillytavern/scripts/openai';
import { SECRET_KEYS } from '@sillytavern/scripts/secrets';
import { selectedProfile } from '../settings/access.js';
import { normalizeModelList, modelIdsFromPayload } from '../utils/model-list.js';
import { buildModelsEndpoint } from '../utils/url.js';
import { parseCustomHeaders } from '../utils/headers.js';
import { normalizeText } from '../utils/text.js';
import { fetchJsonWithTimeout } from '../fetch.js';
import {
    findSecretBounded, readAuthoritativeSecretState, ensureEmptySecret, rotateSecretVerified,
} from '../secrets/api.js';
import { enterFailClosedState } from '../apply/fail-closed.js';
import { getEditorModel, syncEditorModelToNative } from '../native/fields.js';
import { promptName } from '../popups.js';
import { renderModelControl, renderStatus, updateCredentialEditor } from '../ui/render.js';
import type { ModelFetchResult, Profile } from '../types.js';

async function fetchModelsFrontend(profile: Profile, endpoint: string): Promise<ModelFetchResult> {
    const key = profile.secretId ? await findSecretBounded(SECRET_KEYS.CUSTOM, profile.secretId) : '';
    if (profile.secretId && key === null) throw new Error('浏览器无权读取已保存 Key');
    const headers: Record<string, string> = { Accept: 'application/json', ...parseCustomHeaders(profile.includeHeaders) };
    if (key && !Object.keys(headers).some(name => name.toLowerCase() === 'authorization')) headers.Authorization = `Bearer ${key}`;
    const { response, data } = await fetchJsonWithTimeout(buildModelsEndpoint(endpoint), { method: 'GET', headers, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const models = modelIdsFromPayload(data);
    if (!models.length) throw new Error('前端 /models 响应未包含模型列表');
    return { models, route: '前端 /models' };
}

interface BackendSecretState {
    previousActiveId: string;
    desiredSecretId: string;
}

async function prepareBackendSecret(profile: Profile): Promise<BackendSecretState> {
    const authoritative = await readAuthoritativeSecretState();
    if (!authoritative) throw new Error('无法读取 Custom 密钥权威状态');
    const customEntries = Array.isArray(authoritative[SECRET_KEYS.CUSTOM]) ? authoritative[SECRET_KEYS.CUSTOM] : [];
    const previousActiveId = customEntries.find((entry: any) => entry.active)?.id || '';
    const boundSecretExists = Boolean(profile.secretId && customEntries.some((entry: any) => entry.id === profile.secretId));
    if (profile.secretId && !boundSecretExists) {
        profile.secretId = '';
        profile.needsSecret = true;
        saveSettingsDebounced();
        updateCredentialEditor(profile);
    }
    const desiredSecretId = boundSecretExists ? profile.secretId : await ensureEmptySecret(SECRET_KEYS.CUSTOM);
    if (!desiredSecretId) throw new Error('无法建立 Profile 对应的安全 Custom 密钥');
    if (previousActiveId !== desiredSecretId && !await rotateSecretVerified(SECRET_KEYS.CUSTOM, desiredSecretId)) {
        throw new Error('无法激活 Profile 绑定的 Custom 密钥');
    }
    return { previousActiveId, desiredSecretId };
}

async function fetchModelsBackend(profile: Profile, endpoint: string, frontendError: unknown): Promise<ModelFetchResult> {
    const secretState = await prepareBackendSecret(profile);
    try {
        const { response, data } = await fetchJsonWithTimeout('/api/backends/chat-completions/status', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                chat_completion_source: chat_completion_sources.CUSTOM,
                reverse_proxy: '',
                proxy_password: '',
                custom_url: endpoint,
                custom_include_headers: profile.includeHeaders,
            }),
            cache: 'no-cache',
        }, 20000);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const models = modelIdsFromPayload(data);
        if (!models.length) throw new Error('后端 status 响应未包含模型列表');
        return { models, route: '后端 status fallback', frontendError };
    } catch (backendError) {
        const error = new Error(`前端 /models：${(frontendError as Error | null)?.message || '失败'}；后端 status：${(backendError as Error).message}`);
        error.cause = backendError;
        throw error;
    } finally {
        const { previousActiveId, desiredSecretId } = secretState;
        if (previousActiveId && desiredSecretId && previousActiveId !== desiredSecretId) {
            const restored = await rotateSecretVerified(SECRET_KEYS.CUSTOM, previousActiveId);
            if (!restored) await enterFailClosedState('模型获取后无法恢复原 Custom 活动密钥。', SECRET_KEYS.CUSTOM);
        }
    }
}

export async function fetchModelsForProfile(profile: Profile, endpoint: string): Promise<ModelFetchResult> {
    let frontendError: unknown = null;
    try {
        return await fetchModelsFrontend(profile, endpoint);
    } catch (error) {
        frontendError = error;
        console.warn('[QuickerApi] Frontend /models failed; falling back to backend status:', error);
    }
    return await fetchModelsBackend(profile, endpoint, frontendError);
}

export async function fetchCustomModels(): Promise<void> {
    const profile = selectedProfile();
    if (!profile || profile.format !== 'openai') { toastr.info('请先选择并保存 OpenAI Compatible 配置。'); return; }
    if (normalizeText($('#quicker_api_key_input').val())) { toastr.info('请先点击保存按钮保存当前 Key，再获取模型。'); return; }
    const editorUrl = normalizeText($('#quicker_api_url').val());
    if (!editorUrl) { toastr.warning('请先填写 Custom URL。'); return; }
    if (editorUrl !== normalizeText(profile.endpoint)) { toastr.info('URL 已变化，请先保存配置；保存会清空旧远端快照并保留已选模型。'); return; }
    try {
        const result = await fetchModelsForProfile(profile, editorUrl);
        profile.fetchedModels = result.models;
        profile.fetchedFromEndpoint = editorUrl;
        if (!profile.customized) profile.availableModels = normalizeModelList([profile.model, ...result.models]);
        profile.updatedAt = new Date().toISOString();
        saveSettingsDebounced();
        renderModelControl(profile);
        $('#quicker_api_custom_model').val(profile.model);
        toastr.success(`通过${result.route}获取 ${result.models.length} 个模型。`);
        renderStatus();
    } catch (error) {
        console.error('[QuickerApi] Model fetch failed:', error);
        toastr.error('前端 /models 与后端 status 均获取失败。');
        renderStatus();
    }
}

export async function addCustomModel(): Promise<void> {
    const profile = selectedProfile();
    if (!profile || profile.format !== 'openai') { toastr.info('请先选择并保存 OpenAI Compatible 配置。'); return; }
    const model = await promptName('输入 Custom 模型 ID：', getEditorModel('openai'));
    if (!model) return;
    profile.availableModels = normalizeModelList([...(profile.availableModels || []), model]);
    profile.customized = true;
    profile.updatedAt = new Date().toISOString();
    saveSettingsDebounced();
    renderModelControl(profile);
    $('#quicker_api_custom_model').val(model);
    syncEditorModelToNative();
    renderStatus();
}
