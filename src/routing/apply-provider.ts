// 连接层（扳道工）：把选中单元的 provider/key 写回 ST 原生连接字段。
// 只赋值不新增；请求仍由 ST 原生发出。附带轻量快照/回滚。
// 格式映射：
//   custom   → source=custom + custom_url + custom_api_format=openai_compat
//   deepseek → source=deepseek + reverse_proxy + deepseek_model + SECRET_KEYS.DEEPSEEK

import { oai_settings, chat_completion_sources } from '@sillytavern/scripts/openai';
import { setOnlineStatus } from '@sillytavern/script';
import { SECRET_KEYS, secret_state } from '@sillytavern/scripts/secrets';
import { clampContextLimit } from '../domain/context.js';
import { computeVendorTokenClamps } from '../domain/vendor.js';
import { debugLog } from '../debug.js';
import type { Vendor } from '../types.js';

const CUSTOM_API_FORMAT_VALUES: Record<string, string> = {
    'custom': 'openai_compat',
};

function syncInput(selector: string, value: string | number | null | undefined, eventType = 'input'): void {
    const el = $(selector);
    if (el.length && String(el.val() ?? '') !== String(value ?? '')) {
        el.val(value ?? '').trigger(eventType);
    }
}

/** 快照当前连接字段（路由开始前调用）。 */
export function snapshotConnection(): Record<string, string> {
    return {
        source: String(oai_settings.chat_completion_source || ''),
        custom_url: String(oai_settings.custom_url || ''),
        custom_model: String(oai_settings.custom_model || ''),
        custom_api_format: String(oai_settings.custom_api_format || 'openai_compat'),
        reverse_proxy: String(oai_settings.reverse_proxy || ''),
        deepseek_model: String(oai_settings.deepseek_model || ''),
        max_context: String(oai_settings.openai_max_context || ''),
        max_tokens: String(oai_settings.openai_max_tokens || ''),
        apiKeyCustom: String(secret_state?.[SECRET_KEYS.CUSTOM] ?? ''),
        apiKeyDeepseek: String(secret_state?.[SECRET_KEYS.DEEPSEEK] ?? ''),
    };
}

/** 恢复连接字段（应用失败/路由取消时调用）。 */
export function restoreConnection(snapshot: Record<string, string>): void {
    oai_settings.custom_url = snapshot.custom_url;
    oai_settings.custom_model = snapshot.custom_model;
    oai_settings.custom_api_format = snapshot.custom_api_format;
    oai_settings.reverse_proxy = snapshot.reverse_proxy;
    oai_settings.deepseek_model = snapshot.deepseek_model;
    if (snapshot.max_context) {
        oai_settings.openai_max_context = Number(snapshot.max_context) || 0;
        syncInput('#openai_max_context', oai_settings.openai_max_context);
        syncInput('#openai_max_context_counter', oai_settings.openai_max_context);
    }
    if (snapshot.max_tokens) {
        oai_settings.openai_max_tokens = Number(snapshot.max_tokens) || 0;
        syncInput('#openai_max_tokens', oai_settings.openai_max_tokens);
    }
    if (secret_state) {
        secret_state[SECRET_KEYS.CUSTOM] = snapshot.apiKeyCustom;
        secret_state[SECRET_KEYS.DEEPSEEK] = snapshot.apiKeyDeepseek;
    }
    syncInput('#custom_api_url_text', snapshot.custom_url);
    syncInput('#custom_model_id', snapshot.custom_model);
    syncInput('#api_key_custom', snapshot.apiKeyCustom);
    syncInput('#openai_reverse_proxy', snapshot.reverse_proxy);
    syncInput('#model_deepseek_select', snapshot.deepseek_model, 'change');
    syncInput('#api_key_deepseek', snapshot.apiKeyDeepseek);
    if (String(oai_settings.chat_completion_source) !== snapshot.source) {
        syncInput('#chat_completion_source', snapshot.source, 'change');
    }
}

/** 同步 source 下拉显示但不触发 change（避免 ST 的 reconnectOpenAi → /v1/models）。 */
function setSourceSelect(source: string): void {
    const el = $('#chat_completion_source');
    if (el.length && String(el.val() ?? '') !== source) {
        el.val(source);
    }
}

function applyConnectionFields(format: string, endpoint: string, apiKey: string, model: string): void {
    if (format === 'deepseek') {
        oai_settings.chat_completion_source = chat_completion_sources.DEEPSEEK;
        oai_settings.reverse_proxy = endpoint;
        oai_settings.deepseek_model = model;
        if (apiKey && secret_state) secret_state[SECRET_KEYS.DEEPSEEK] = apiKey;
        setSourceSelect(chat_completion_sources.DEEPSEEK);
        syncInput('#openai_reverse_proxy', endpoint);
        syncInput('#model_deepseek_select', model, 'change');
        if (apiKey) syncInput('#api_key_deepseek', apiKey);
        return;
    }

    oai_settings.chat_completion_source = chat_completion_sources.CUSTOM;
    oai_settings.custom_url = endpoint;
    oai_settings.custom_model = model;
    oai_settings.custom_api_format = CUSTOM_API_FORMAT_VALUES[format] ?? 'openai_compat';
    if (apiKey && secret_state) secret_state[SECRET_KEYS.CUSTOM] = apiKey;

    setSourceSelect(chat_completion_sources.CUSTOM);
    syncInput('#custom_api_url_text', endpoint);
    syncInput('#custom_model_id', model);
    if (apiKey) syncInput('#api_key_custom', apiKey);
}

/** 新 Vendor/Group 路由连接：Vendor + 条目 Key + 真实模型名。token 钳制由调用方按确认结果决定。 */
export function applyVendorConnection(vendor: Vendor, apiKey: string, model: string): void {
    const format = String(vendor?.format || 'custom');
    const endpoint = String(vendor?.endpoint || '').trim();
    applyConnectionFields(format, endpoint, String(apiKey || ''), model);
    // 路由已按该 Vendor 写入连接字段，让 ST 立即显示已连接（否则输入框状态仍是 no_connection）
    setOnlineStatus('Valid');
    debugLog('applyVendorConnection synced to ST', {
        vendorId: vendor?.id,
        vendorName: vendor?.name,
        format,
        endpoint,
        model,
        hasKey: Boolean(apiKey),
        stOnlineStatus: 'Valid',
    });
}

/** 按 Vendor 的上下文/输入/输出上限钳制 ST token 设置。 */
export function applyVendorTokenClamps(vendor: Vendor): void {
    const clamps = computeVendorTokenClamps(vendor, {
        maxContext: Number(oai_settings.openai_max_context) || 0,
        maxOutputTokens: Number(oai_settings.openai_max_tokens) || 0,
    });
    if (clamps.maxContext !== undefined) {
        const clamped = clampContextLimit(Number(oai_settings.openai_max_context) || 0, clamps.maxContext);
        oai_settings.openai_max_context = clamped;
        syncInput('#openai_max_context', clamped);
        syncInput('#openai_max_context_counter', clamped);
    }
    if (clamps.maxOutputTokens !== undefined) {
        oai_settings.openai_max_tokens = clamps.maxOutputTokens;
        syncInput('#openai_max_tokens', clamps.maxOutputTokens);
    }
}
