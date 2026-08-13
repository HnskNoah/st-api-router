// 密钥编辑器：绑定 / 读取 / 显示 / 复制

import { oai_settings } from '@sillytavern/scripts/openai';
import { saveSettingsDebounced } from '@sillytavern/script';
import { FORMATS } from '../constants.js';
import { settings, selectedProfile } from '../settings/access.js';
import { normalizeFormat } from '../utils/format.js';
import { normalizeText } from '../utils/text.js';
import {
    ensureSecret, readAuthoritativeSecretState, rotateSecretVerified, findSecretBounded,
} from '../secrets/api.js';
import { ensureBoundProxyPreset, getBoundProxyPreset } from '../native/proxy.js';
import { clearCredentialSafetyBlock, enterFailClosedState } from '../apply/fail-closed.js';
import { renderStatus } from '../ui/render.js';
import type { Profile } from '../types.js';

export async function saveAndBindInputKey(profile: Profile, requestedFormat?: string, endpointOverride: string | null = null): Promise<boolean> {
    if (!profile) {
        toastr.info('请先选择或新建配置。');
        return false;
    }
    const format = normalizeFormat(requestedFormat ?? profile.format);
    const config = FORMATS[format];
    const endpoint = endpointOverride === null ? String(oai_settings[config.endpointField] || '') : String(endpointOverride || '');
    const value = normalizeText($('#quicker_api_key_input').val() || $(config.keyInput).val());
    if (format !== 'openai' && endpoint) {
        if (!value) return true;
        profile.proxyPreset = ensureBoundProxyPreset(profile.name, endpoint, value, profile.proxyPreset, profile.id);
        profile.secretId = '';
        profile.needsSecret = false;
        oai_settings.proxy_password = value;
        $('#openai_proxy_password').val(value).trigger('input');
        profile.updatedAt = new Date().toISOString();
        saveSettingsDebounced();
        return true;
    }
    if (!value) return true;
    const before = await readAuthoritativeSecretState();
    if (!before) {
        toastr.error('无法读取写入前的权威密钥状态。');
        return false;
    }
    const previousId = before[config.secretKey]?.find((entry: any) => entry.active)?.id || '';
    const result = await ensureSecret(config.secretKey, value, profile.name);
    if (!result.id) {
        if (!previousId || !await rotateSecretVerified(config.secretKey, previousId)) await enterFailClosedState('密钥保存状态无法确认且回滚失败。', config.secretKey);
        toastr.error('密钥保存或激活状态无法确认。');
        return false;
    }
    clearCredentialSafetyBlock(config.secretKey);
    profile.secretId = result.id;
    profile.needsSecret = false;
    profile.updatedAt = new Date().toISOString();
    saveSettingsDebounced();
    if (!result.exposureAvailable) toastr.warning('凭据已保存；findSecret 无权限，无法检查历史密钥是否同值。');
    return true;
}

export async function readBoundSecret(profile: Profile | null): Promise<string | null> {
    if (profile?.format !== 'openai' && profile?.endpoint) {
        const proxyPreset = getBoundProxyPreset(profile);
        if (!proxyPreset) {
            toastr.warning('当前 Profile 没有可用的原生 Reverse Proxy Preset。');
            return null;
        }
        return String(proxyPreset.password || '');
    }
    if (!profile?.secretId) {
        toastr.info('当前 Profile 未绑定密钥。');
        return null;
    }
    const value = await findSecretBounded(FORMATS[profile.format].secretKey, profile.secretId);
    if (value === null) {
        toastr.warning('当前实例未授予 findSecret 明文权限（allowKeysExposure）；已降级为仅显示标签和管理入口。');
        renderStatus('密钥明文不可读');
        return null;
    }
    return value;
}

export async function revealBoundSecret(): Promise<void> {
    const profile = selectedProfile();
    const input = $('#quicker_api_key_input');
    if (!String(input.val() || '')) {
        const value = await readBoundSecret(profile);
        if (value === null) return;
        input.val(value);
    }
    const showing = input.attr('type') === 'text';
    input.attr('type', showing ? 'password' : 'text');
    $('#quicker_api_reveal_key i').attr('class', showing ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye');
}

export async function copyBoundSecret(): Promise<void> {
    const inputValue = String($('#quicker_api_key_input').val() || '');
    const value = inputValue || await readBoundSecret(selectedProfile());
    if (value === null) return;
    try {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        await Promise.race([
            navigator.clipboard.writeText(value),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error('Clipboard write timed out')), 5000);
            }),
        ]).finally(() => {
            if (timeoutId) clearTimeout(timeoutId);
        });
        toastr.success('绑定密钥已复制到剪贴板。');
    } catch {
        toastr.error('浏览器拒绝剪贴板写入。');
    }
}
