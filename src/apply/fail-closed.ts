// 安全降级 / fail-closed 逻辑

import { oai_settings } from '@sillytavern/scripts/openai';
import { chat_completion_sources } from '@sillytavern/scripts/openai';
import { saveSettingsDebounced } from '@sillytavern/script';
import { SECRET_KEYS } from '@sillytavern/scripts/secrets';
import { ensureEmptySecret, rotateSecretVerified } from '../secrets/api.js';
import { settings } from '../settings/access.js';
import { restoreNative } from '../native/snapshot.js';
import { renderProfiles } from '../ui/render.js';
import type { FormatConfig, NativeSnapshot } from '../types.js';

export function setCredentialSafetyBlock(secretKey: string, message: string): void {
    settings().blockedSecretKeys[secretKey] = message || `${secretKey} 密钥状态无法确认；使用该官方来源时生成请求将被阻断。`;
    settings().activeProfileId = null;
    saveSettingsDebounced();
    renderProfiles(settings().selectedProfileId);
}

export function clearCredentialSafetyBlock(secretKey: string): void {
    if (!settings().blockedSecretKeys[secretKey]) return;
    delete settings().blockedSecretKeys[secretKey];
    saveSettingsDebounced();
}

export async function enterFailClosedState(message: string, affectedSecretKey: string = SECRET_KEYS.CUSTOM): Promise<void> {
    const safeId = await ensureEmptySecret(affectedSecretKey);
    if (affectedSecretKey === SECRET_KEYS.CUSTOM) {
        oai_settings.custom_url = '';
        oai_settings.custom_model = '';
        $('#custom_api_url_text').val('').trigger('input');
        $('#custom_model_id').val('').trigger('input');
        $('#chat_completion_source').val(chat_completion_sources.CUSTOM).trigger('change');
    }
    settings().activeProfileId = null;
    if (safeId) {
        delete settings().blockedSecretKeys[affectedSecretKey];
    } else {
        settings().blockedSecretKeys[affectedSecretKey] = `${message} ${affectedSecretKey} 密钥槽状态无法确认，生成已阻断。`;
    }
    saveSettingsDebounced();
    renderProfiles();
    toastr.error(`${message} ${safeId ? '受影响密钥槽已切换至安全空密钥。' : '无法确认安全空密钥，使用该槽的生成已阻断。'}`);
}

export async function rollbackCredentialOrFailClosed(config: FormatConfig, previousSecretId: string, message: string): Promise<boolean> {
    if (previousSecretId && await rotateSecretVerified(config.secretKey, previousSecretId)) return true;
    await enterFailClosedState(message, config.secretKey);
    return false;
}

export async function rollbackStaleCredential(config: FormatConfig, previousSecretId: string, message: string): Promise<boolean> {
    if (previousSecretId && await rotateSecretVerified(config.secretKey, previousSecretId)) return true;
    const safeId = await ensureEmptySecret(config.secretKey);
    if (safeId) {
        toastr.warning('旧 Profile 已取消，但原密钥无法恢复；对应密钥槽已切换到安全空密钥。');
        return false;
    }
    setCredentialSafetyBlock(config.secretKey, message);
    return false;
}

export async function rollbackOrFailClosed(config: FormatConfig, previousSecretId: string, nativeSnapshot: NativeSnapshot, message: string): Promise<boolean> {
    restoreNative(nativeSnapshot);
    return await rollbackCredentialOrFailClosed(config, previousSecretId, message);
}
