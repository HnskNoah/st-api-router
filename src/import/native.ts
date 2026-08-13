// 原生 OAI 设置导入（批量迁移）

import { extension_settings } from '@sillytavern/scripts/extensions';
import { oai_settings, proxies } from '@sillytavern/scripts/openai';
import { saveSettingsDebounced } from '@sillytavern/script';
import { SECRET_KEYS } from '@sillytavern/scripts/secrets';
import { POPUP_TYPE } from '@sillytavern/scripts/popup';
import { FORMATS } from '../constants.js';
import { settings, profiles } from '../settings/access.js';
import { normalizeProfile, importIdentity, nativeImportFingerprint, uniqueName } from '../domain/profile.js';
import { normalizeFormat } from '../utils/format.js';
import { normalizeText, sanitizeName } from '../utils/text.js';
import { makeId } from '../utils/id.js';
import { callQuickerPopup } from '../popups.js';
import {
    readAuthoritativeSecretState, findSecretBounded, ensureSecret, ensureEmptySecret, rotateSecretVerified,
} from '../secrets/api.js';
import { getSecretEntry } from '../secrets/access.js';
import { getBoundProxyPreset } from '../native/proxy.js';
import { enterFailClosedState } from '../apply/fail-closed.js';
import { renderProfiles } from '../ui/render.js';
import type { CredentialDescriptor, NativeImportCandidate, ResolvedImportCredential } from '../types.js';

async function credentialDescriptor(secretKey = '', secretId = '', plainValue = ''): Promise<CredentialDescriptor> {
    const value = normalizeText(plainValue);
    if (value) return { value, identity: `value:${value}`, exposureDenied: false };
    if (!secretKey || !secretId || !getSecretEntry(secretKey, secretId)) {
        return { value: '', identity: 'empty:', exposureDenied: false };
    }
    const exposed = await findSecretBounded(secretKey, secretId);
    if (exposed === null) return { value: '', identity: `secret:${secretKey}:${secretId}`, exposureDenied: true };
    const normalized = normalizeText(exposed);
    return { value: normalized, identity: normalized ? `value:${normalized}` : 'empty:', exposureDenied: false };
}

export async function collectNativeImportCandidates(authoritative: Record<string, any>): Promise<NativeImportCandidate[]> {
    const candidates: NativeImportCandidate[] = [];
    const add = async (candidate: Record<string, any>): Promise<void> => {
        const format = normalizeFormat(candidate.format);
        const endpoint = normalizeText(candidate.endpoint);
        const credential = await credentialDescriptor(candidate.sourceSecretKey, candidate.sourceSecretId, candidate.plainKey);
        const fingerprintSource = {
            sourceRef: candidate.sourceRef,
            sourceLabel: candidate.sourceLabel,
            sourceSecretKey: candidate.sourceSecretKey,
            sourceSecretId: candidate.sourceSecretId,
            proxyPreset: candidate.proxyPreset,
        };
        const normalized: NativeImportCandidate = {
            sourceRef: String(candidate.sourceRef || ''),
            sourceLabel: String(candidate.sourceLabel || ''),
            proxyPreset: String(candidate.proxyPreset || ''),
            plainKey: String(candidate.plainKey || ''),
            sourceSecretKey: String(candidate.sourceSecretKey || ''),
            sourceSecretId: String(candidate.sourceSecretId || ''),
            format,
            name: sanitizeName(candidate.name) || '原生连接配置',
            endpoint,
            model: normalizeText(candidate.model),
            credential,
            identity: importIdentity(format, endpoint, credential.identity),
            fingerprint: nativeImportFingerprint(fingerprintSource, format, endpoint),
        };
        if (!candidates.some(item => item.identity === normalized.identity)) candidates.push(normalized);
    };

    const activeOpenAI = authoritative[SECRET_KEYS.OPENAI]?.find((entry: any) => entry.active) || null;
    const reverseProxy = normalizeText(oai_settings.reverse_proxy);
    if (reverseProxy || oai_settings.openai_model || activeOpenAI) {
        await add({
            sourceRef: reverseProxy ? 'current-openai:reverse-proxy' : 'current-openai:official',
            sourceLabel: '当前 OpenAI', name: '当前 OpenAI 配置', format: 'openai',
            endpoint: reverseProxy || 'https://api.openai.com/v1', model: oai_settings.openai_model,
            plainKey: reverseProxy ? oai_settings.proxy_password : '',
            sourceSecretKey: reverseProxy ? '' : SECRET_KEYS.OPENAI,
            sourceSecretId: reverseProxy ? '' : activeOpenAI?.id,
        });
    }

    const managerProfiles = Array.isArray(extension_settings?.connectionManager?.profiles)
        ? extension_settings.connectionManager.profiles : [];
    const referencedProxyNames = new Set(managerProfiles.map((profile: any) => profile?.proxy).filter(Boolean));
    const sourceFormats: Record<string, string> = { openai: 'openai', custom: 'openai', claude: 'anthropic', makersuite: 'gemini' };
    for (const nativeProfile of managerProfiles) {
        const format = normalizeFormat(sourceFormats[nativeProfile?.api]);
        if (!FORMATS[format]) continue;
        const config = FORMATS[format];
        const proxy = nativeProfile.proxy ? proxies.find((item: any) => item.name === nativeProfile.proxy) : null;
        const endpoint = format === 'openai'
            ? normalizeText(proxy?.url || nativeProfile['api-url'] || 'https://api.openai.com/v1')
            : normalizeText(proxy?.url || nativeProfile['api-url']);
        const proxyMode = format !== 'openai' && Boolean(endpoint);
        const usesProxyCredential = Boolean(proxy?.url);
        await add({
            sourceRef: `connection-manager:${normalizeText(nativeProfile.id || nativeProfile.name)}`,
            sourceLabel: `Connection Manager (${nativeProfile.api})`, name: nativeProfile.name, format,
            endpoint, model: nativeProfile.model, proxyPreset: proxyMode ? proxy?.name || '' : '',
            plainKey: usesProxyCredential ? proxy.password : '',
            sourceSecretKey: usesProxyCredential || proxyMode ? '' : (nativeProfile.api === 'openai' ? SECRET_KEYS.OPENAI : config.secretKey),
            sourceSecretId: usesProxyCredential || proxyMode ? '' : nativeProfile['secret-id'],
        });
    }

    for (const proxy of proxies) {
        if (!normalizeText(proxy?.url) || proxy.name === 'None' || referencedProxyNames.has(proxy.name)) continue;
        await add({
            sourceRef: `reverse-proxy-preset:${normalizeText(proxy.name)}`,
            sourceLabel: 'Reverse Proxy Preset', name: proxy.name, format: 'openai', endpoint: proxy.url,
            model: '', plainKey: proxy.password, sourceSecretKey: '', sourceSecretId: '',
        });
    }

    const existing = new Set<string>();
    const existingFingerprints = new Set(profiles().map(profile => normalizeText(profile.nativeImportFingerprint)).filter(Boolean));
    for (const profile of profiles()) {
        const proxyMode = profile.format !== 'openai' && Boolean(profile.endpoint);
        const proxy = proxyMode ? getBoundProxyPreset(profile) : null;
        const credential = await credentialDescriptor(
            proxyMode ? '' : FORMATS[profile.format].secretKey,
            proxyMode ? '' : profile.secretId,
            proxyMode ? proxy?.password ?? '' : '',
        );
        existing.add(importIdentity(profile.format, profile.endpoint, credential.identity));
    }
    return candidates.filter(candidate => !existing.has(candidate.identity) && !existingFingerprints.has(candidate.fingerprint));
}

export function buildNativeImportPreview(candidates: NativeImportCandidate[]): JQuery<HTMLElement> {
    const content = $('<div class="quicker-api__model-manager quicker-api__migration">')
        .append($('<div class="quicker-api__manager-note">').text('仅列出尚未存在的原生连接；选择后迁移，不修改原配置。'));
    const list = $('<div class="quicker-api__model-list">');
    candidates.forEach((candidate, index) => {
        const checkbox = $('<input type="checkbox">').attr('data-index', index);
        const details = $('<div class="quicker-api__migration-summary">')
            .text(`${candidate.name} · ${candidate.endpoint || '官方端点'}`);
        list.append($('<label class="quicker-api__model-item quicker-api__remote-model">').append(checkbox, details));
    });
    return content.append(list);
}

export async function resolveNativeImportCredential(candidate: NativeImportCandidate, authoritative: Record<string, any>): Promise<ResolvedImportCredential> {
    const targetKey = FORMATS[candidate.format].secretKey;
    if (candidate.proxyPreset && candidate.format !== 'openai') {
        return { secretId: '', proxyPreset: candidate.proxyPreset, needsSecret: !candidate.credential.value, exposureDenied: false };
    }
    if (candidate.sourceSecretKey === targetKey && candidate.sourceSecretId
        && authoritative[targetKey]?.some((entry: any) => entry.id === candidate.sourceSecretId)) {
        return { secretId: candidate.sourceSecretId, proxyPreset: '', needsSecret: false, exposureDenied: false };
    }
    if (!candidate.credential.value) {
        return { secretId: '', proxyPreset: '', needsSecret: true, exposureDenied: candidate.credential.exposureDenied };
    }
    const result = await ensureSecret(targetKey, candidate.credential.value, candidate.name);
    return { secretId: result.id, proxyPreset: '', needsSecret: !result.id, exposureDenied: false };
}

export async function importNativeProfile(): Promise<void> {
    const authoritative = await readAuthoritativeSecretState();
    if (!authoritative) { toastr.error('无法读取原生凭据状态，已取消迁移。'); return; }
    const candidates = await collectNativeImportCandidates(authoritative);
    if (!candidates.length) { toastr.info('未检测到尚未迁移的原生连接配置。'); return; }
    const preview = buildNativeImportPreview(candidates);
    const confirmed = await callQuickerPopup(preview, POPUP_TYPE.CONFIRM, '', {
        okButton: '添加',
        cancelButton: '取消',
        animation: 'none',
    });
    if (!confirmed) return;
    const indexes = preview.find('input[type="checkbox"]:checked').map((_, input) => Number(input.dataset.index)).get();
    if (!indexes.length) return;

    const baselineIds: Record<string, string> = {};
    const targetKeys = new Set(indexes.map(index => FORMATS[candidates[index].format].secretKey));
    for (const key of targetKeys) {
        baselineIds[key] = authoritative[key]?.find((entry: any) => entry.active)?.id || await ensureEmptySecret(key);
        if (!baselineIds[key]) { toastr.error('无法建立凭据安全基线，已取消迁移。'); return; }
    }
    let imported = 0;
    let pending = 0;
    try {
        for (const index of indexes) {
            const candidate = candidates[index];
            const credential = await resolveNativeImportCredential(candidate, authoritative);
            profiles().push(normalizeProfile({
                id: makeId(), name: uniqueName(candidate.name, profiles()), format: candidate.format,
                endpoint: candidate.endpoint, model: candidate.model,
                secretId: credential.secretId, proxyPreset: credential.proxyPreset,
                needsSecret: credential.needsSecret,
                nativeImportFingerprint: candidate.fingerprint,
                availableModels: candidate.format === 'openai' ? [candidate.model] : [],
                updatedAt: new Date().toISOString(),
            }));
            imported++;
            if (credential.needsSecret || credential.exposureDenied) pending++;
        }
    } finally {
        for (const [key, id] of Object.entries(baselineIds)) {
            if (!await rotateSecretVerified(key, id)) await enterFailClosedState('迁移后无法恢复原活动凭据。', key);
        }
    }
    saveSettingsDebounced();
    renderProfiles(settings().selectedProfileId);
    if (imported) toastr.success(`已迁移 ${imported} 个原生连接配置。`);
    if (pending) toastr.warning(`${pending} 个配置需要重新配置凭据。`);
}
