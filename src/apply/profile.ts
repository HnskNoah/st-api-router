// Profile 应用（拆解自 index.js applyProfile，保留 generation guard 与 fail-closed 语义）

import { oai_settings } from '@sillytavern/scripts/openai';
import { saveSettingsDebounced } from '@sillytavern/script';
import { FORMATS } from '../constants.js';
import { runtimeState } from '../state.js';
import { settings } from '../settings/access.js';
import { normalizeText } from '../utils/text.js';
import {
    readAuthoritativeSecretState, ensureEmptySecret, rotateSecretVerified, findSecretBounded,
} from '../secrets/api.js';
import { getActiveSecret } from '../secrets/access.js';
import { snapshotNative, restoreNative } from '../native/snapshot.js';
import { applyNativeFields, getEditorModel } from '../native/fields.js';
import { getBoundProxyPreset } from '../native/proxy.js';
import { clearCredentialSafetyBlock, rollbackOrFailClosed, rollbackStaleCredential } from './fail-closed.js';
import { renderModelControl, renderProfiles } from '../ui/render.js';
import { endPresetTransition } from '../presets/transition.js';
import { debugLog } from '../debug.js';
import type { FormatConfig, NativeSnapshot, Profile } from '../types.js';

function refreshModelControlAfterApply(profile: Profile, config: FormatConfig, applyModel: boolean): void {
    if (!applyModel) {
        renderModelControl(profile, String(oai_settings[config.modelField] || ''));
        runtimeState.editorModelBaseline = getEditorModel(profile.format);
    }
}

async function applyProxyProfile(
    profile: Profile, config: FormatConfig, nativeSnapshot: NativeSnapshot,
    expectedGeneration: number, keepPresetTransition: boolean, applyModel: boolean,
): Promise<boolean> {
    const previousSelection = settings().activeProfileId;
    const proxyPreset = getBoundProxyPreset(profile);
    if (!proxyPreset || normalizeText(proxyPreset.url) !== normalizeText(profile.endpoint)) {
        toastr.error(`${config.label} 反代 Profile 缺少匹配的原生 Reverse Proxy Preset，请重新保存该 Profile。`);
        renderProfiles(settings().selectedProfileId);
        return false;
    }
    try {
        applyNativeFields(profile, String(proxyPreset.password || ''), applyModel);
        if ($('#openai_proxy_preset option').filter((_, option) => (option as HTMLOptionElement).value === proxyPreset.name).length) {
            $('#openai_proxy_preset').val(proxyPreset.name).trigger('change');
        }
        if (runtimeState.extensionDisabled) throw new Error('Extension disabled while applying proxy profile');
        settings().activeProfileId = profile.id;
        if (!keepPresetTransition) endPresetTransition();
        saveSettingsDebounced();
        renderProfiles(profile.id);
        refreshModelControlAfterApply(profile, config, applyModel);
        return true;
    } catch (error) {
        console.error('[QuickerApi] Proxy field application failed:', error);
        restoreNative(nativeSnapshot);
        settings().activeProfileId = previousSelection;
        saveSettingsDebounced();
        renderProfiles(settings().selectedProfileId);
        return false;
    }
}

interface SecretPreparation {
    ok: boolean;
    previousSecretId: string;
}

async function prepareAndActivateSecret(
    profile: Profile, config: FormatConfig, authoritative: Record<string, any>,
    nativeSnapshot: NativeSnapshot, expectedGeneration: number,
): Promise<SecretPreparation> {
    const previousSecretId = authoritative[config.secretKey]?.find((entry: any) => entry.active)?.id || '';
    let targetSecretId = profile.secretId;
    if (!targetSecretId || !authoritative[config.secretKey]?.some((entry: any) => entry.id === targetSecretId)) {
        const expectedSecret = Boolean(profile.needsSecret || targetSecretId);
        targetSecretId = await ensureEmptySecret(config.secretKey);
        if (expectedGeneration !== runtimeState.profileSelectionGeneration || runtimeState.extensionDisabled) {
            await rollbackStaleCredential(config, previousSecretId, 'Profile 已被新的原生预设取消，但密钥状态无法确认；生成请求已阻断。');
            return { ok: false, previousSecretId };
        }
        if (!targetSecretId) {
            await rollbackOrFailClosed(config, previousSecretId, nativeSnapshot, '无法建立目标格式的安全空密钥。');
            renderProfiles(settings().selectedProfileId);
            return { ok: false, previousSecretId };
        }
        profile.secretId = targetSecretId;
        profile.needsSecret = expectedSecret;
        if (expectedSecret) toastr.warning('原绑定密钥不存在，已改用安全空密钥；请重新绑定后再连接。');
    } else {
        const activated = await rotateSecretVerified(config.secretKey, targetSecretId);
        if (expectedGeneration !== runtimeState.profileSelectionGeneration || runtimeState.extensionDisabled) {
            await rollbackStaleCredential(config, previousSecretId, 'Profile 已被新的原生预设取消，但密钥状态无法确认；生成请求已阻断。');
            return { ok: false, previousSecretId };
        }
        if (!activated) {
            await rollbackOrFailClosed(config, previousSecretId, nativeSnapshot, '目标密钥激活无法确认且回滚失败。');
            renderProfiles(settings().selectedProfileId);
            return { ok: false, previousSecretId };
        }
    }

    if (getActiveSecret(config.secretKey)?.id !== targetSecretId) {
        await rollbackOrFailClosed(config, previousSecretId, nativeSnapshot, '密钥权威状态不一致且回滚失败。');
        renderProfiles(settings().selectedProfileId);
        return { ok: false, previousSecretId };
    }
    return { ok: true, previousSecretId };
}

async function finalizeAppliedProfile(
    profile: Profile, config: FormatConfig, previousSecretId: string,
    nativeSnapshot: NativeSnapshot, keepPresetTransition: boolean, applyModel: boolean,
): Promise<boolean> {
    try {
        applyNativeFields(profile, '', applyModel);
        // Custom 源的原生 status 检查依赖 #api_key_custom 输入框（连接按钮会把它写进 secret 再发请求）。
        // 激活密钥只在服务端/secret_state 里，若不回填输入框，切到 custom 后 status 会因缺 key 报 Unauthorized。
        if (config.secretKey === 'custom') {
            const active = getActiveSecret(config.secretKey);
            if (active) {
                const value = await findSecretBounded(config.secretKey, active.id);
                if (value !== null) {
                    $('#api_key_custom').val(value).trigger('input');
                }
            }
        }
        if (runtimeState.extensionDisabled) throw new Error('Extension disabled while applying profile');
        clearCredentialSafetyBlock(config.secretKey);
        settings().activeProfileId = profile.id;
        if (!keepPresetTransition) endPresetTransition();
        saveSettingsDebounced();
        renderProfiles(profile.id);
        refreshModelControlAfterApply(profile, config, applyModel);
        return true;
    } catch (error) {
        console.error('[QuickerApi] Native field application failed:', error);
        await rollbackOrFailClosed(config, previousSecretId, nativeSnapshot, '原生字段应用失败且回滚密钥失败。');
        renderProfiles(settings().selectedProfileId);
        return false;
    }
}

export async function applyProfile(
    profile: Profile,
    expectedGeneration: number = runtimeState.profileSelectionGeneration,
    keepPresetTransition = false,
    applyModel = true,
): Promise<boolean> {
    debugLog('applyProfile enter', {
        profileId: profile?.id,
        profileName: profile?.name,
        format: profile?.format,
        expectedGeneration,
        currentGeneration: runtimeState.profileSelectionGeneration,
        keepPresetTransition,
        applyModel,
    });
    if (!profile || runtimeState.extensionDisabled || expectedGeneration !== runtimeState.profileSelectionGeneration) {
        debugLog('applyProfile skip: stale/disabled', {
            hasProfile: Boolean(profile),
            extensionDisabled: runtimeState.extensionDisabled,
            generationMatch: expectedGeneration === runtimeState.profileSelectionGeneration,
        });
        return false;
    }
    const config = FORMATS[profile.format];
    const nativeSnapshot = snapshotNative();
    const proxyMode = profile.format !== 'openai' && Boolean(profile.endpoint);
    if (proxyMode) {
        debugLog('applyProfile proxy path', { proxyPreset: profile.proxyPreset, endpoint: profile.endpoint });
        return await applyProxyProfile(profile, config, nativeSnapshot, expectedGeneration, keepPresetTransition, applyModel);
    }

    debugLog('applyProfile reading authoritative secrets');
    const authoritative = await readAuthoritativeSecretState();
    if (expectedGeneration !== runtimeState.profileSelectionGeneration || runtimeState.extensionDisabled) {
        debugLog('applyProfile stale after secret read', { expectedGeneration, currentGeneration: runtimeState.profileSelectionGeneration });
        return false;
    }
    if (!authoritative) {
        toastr.error('无法通过 /api/secrets/read 验证密钥状态，已取消切换。');
        debugLog('applyProfile failed: authoritative secret read returned null');
        renderProfiles(settings().selectedProfileId);
        return false;
    }
    const preparation = await prepareAndActivateSecret(profile, config, authoritative, nativeSnapshot, expectedGeneration);
    if (!preparation.ok) {
        debugLog('applyProfile failed: secret preparation', { previousSecretId: preparation.previousSecretId });
        return false;
    }
    const applied = await finalizeAppliedProfile(profile, config, preparation.previousSecretId, nativeSnapshot, keepPresetTransition, applyModel);
    debugLog('applyProfile done', { applied });
    return applied;
}
