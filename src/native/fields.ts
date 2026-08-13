// 原生连接字段应用与编辑器同步

import { oai_settings } from '@sillytavern/scripts/openai';
import { FORMATS } from '../constants.js';
import { normalizeFormat } from '../utils/format.js';
import { normalizeText } from '../utils/text.js';
import type { Profile } from '../types.js';

export function getEditorModel(format: string = normalizeFormat($('#quicker_api_format').val())): string {
    if (format === 'openai') return normalizeText($('#quicker_api_custom_model').val());
    return normalizeText($('#quicker_api_provider_model').val());
}

export function syncEditorModelToNative(): void {
    const format = normalizeFormat($('#quicker_api_format').val());
    const config = FORMATS[format];
    const model = getEditorModel(format);
    oai_settings[config.modelField] = model;
    $(config.modelInput).val(model).trigger(format === 'openai' ? 'input' : 'change');
}

export function syncEditorConnectionToNative(): void {
    const format = normalizeFormat($('#quicker_api_format').val());
    const config = FORMATS[format];
    const endpoint = normalizeText($('#quicker_api_url').val());
    oai_settings[config.endpointField] = endpoint;
    $(config.endpointInput).val(endpoint).trigger('input');
    syncEditorModelToNative();
}

export function applyNativeFields(profile: Profile, proxyPassword = '', applyModel = true): void {
    const config = FORMATS[profile.format];
    oai_settings[config.endpointField] = profile.endpoint;
    $(config.endpointInput).val(profile.endpoint).trigger('input');
    if (applyModel) {
        oai_settings[config.modelField] = profile.model;
        $(config.modelInput).val(profile.model).trigger(profile.format === 'openai' ? 'input' : 'change');
    }
    if (profile.format === 'openai') {
        oai_settings.custom_include_body = profile.includeBody;
        oai_settings.custom_exclude_body = profile.excludeBody;
        oai_settings.custom_include_headers = profile.includeHeaders;
    } else {
        oai_settings.proxy_password = proxyPassword;
        $('#openai_proxy_password').val(proxyPassword).trigger('input');
    }
    if (oai_settings.chat_completion_source !== config.source) {
        $('#chat_completion_source').val(config.source).trigger('change');
    }
}
