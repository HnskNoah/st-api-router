// 原生连接状态比对与凭据判定

import { oai_settings } from '@sillytavern/scripts/openai';
import { FORMATS } from '../constants.js';
import { normalizeFormat } from '../utils/format.js';
import { settings } from '../settings/access.js';
import { getSecretEntry } from '../secrets/access.js';
import { getBoundProxyPreset } from './proxy.js';
import type { FormatName, Profile } from '../types.js';

export function profileMatchesNative(profile: Profile): boolean {
    const config = FORMATS[profile.format];
    if (oai_settings.chat_completion_source !== config.source) return false;
    if (String(oai_settings[config.modelField] || '') !== profile.model) return false;
    if (String(oai_settings[config.endpointField] || '') !== profile.endpoint) return false;
    if (profile.format !== 'openai' && profile.endpoint) {
        const proxyPreset = getBoundProxyPreset(profile);
        if (!proxyPreset || String(oai_settings.proxy_password || '') !== String(proxyPreset.password || '')) return false;
    }
    return profile.format !== 'openai'
        || (String(oai_settings.custom_include_body || '') === profile.includeBody
            && String(oai_settings.custom_exclude_body || '') === profile.excludeBody
            && String(oai_settings.custom_include_headers || '') === profile.includeHeaders);
}

export function profileHasCredential(profile: Profile | null, format: FormatName, endpoint: string): boolean {
    if (!profile) return false;
    if (format !== 'openai' && endpoint) return Boolean(getBoundProxyPreset(profile)?.password);
    const config = FORMATS[format];
    return Boolean(profile.secretId
        && !profile.needsSecret
        && profile.secretId !== settings().emptySecretIds[config.secretKey]
        && getSecretEntry(config.secretKey, profile.secretId));
}
