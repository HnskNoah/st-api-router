// 从原生连接状态捕获 Profile

import { oai_settings } from '@sillytavern/scripts/openai';
import { FORMATS } from '../constants.js';
import { settings, profiles } from '../settings/access.js';
import { getActiveSecret } from '../secrets/access.js';
import { getEditorModel } from '../native/fields.js';
import { ensureBoundProxyPreset } from '../native/proxy.js';
import { makeId } from '../utils/id.js';
import { normalizeFormat } from '../utils/format.js';
import { normalizeProfile, uniqueName } from '../domain/profile.js';
import type { Profile } from '../types.js';

export function captureNativeProfile(name: string, format: string, existing: Partial<Profile> = {}): Profile {
    const normalizedFormat = normalizeFormat(format);
    const config = FORMATS[normalizedFormat];
    const endpoint = String(oai_settings[config.endpointField] || '');
    const proxyMode = normalizedFormat !== 'openai' && Boolean(endpoint);
    const activeSecret = getActiveSecret(config.secretKey);
    const retainedSecretId = existing.format === normalizedFormat ? String(existing.secretId || '') : '';
    const secretId = proxyMode ? '' : (retainedSecretId || activeSecret?.id || '');
    const needsSecret = !proxyMode && (!secretId || secretId === settings().emptySecretIds[config.secretKey]);
    const profileName = name || existing.name || '';
    const profileId = existing.id || makeId();
    const proxyPreset = proxyMode
        ? ensureBoundProxyPreset(profileName, endpoint, String(oai_settings.proxy_password || ''), existing.proxyPreset || '', profileId)
        : '';
    return normalizeProfile({
        ...existing,
        id: profileId,
        name: uniqueName(profileName, profiles(), existing.id || null),
        format: normalizedFormat,
        endpoint,
        model: getEditorModel(normalizedFormat),
        includeBody: normalizedFormat === 'openai' ? oai_settings.custom_include_body : '',
        excludeBody: normalizedFormat === 'openai' ? oai_settings.custom_exclude_body : '',
        includeHeaders: normalizedFormat === 'openai' ? oai_settings.custom_include_headers : '',
        secretId,
        proxyPreset,
        needsSecret,
        updatedAt: new Date().toISOString(),
    });
}
