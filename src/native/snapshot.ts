// 原生连接字段快照与恢复

import { oai_settings } from '@sillytavern/scripts/openai';
import type { NativeSnapshot } from '../types.js';

export function snapshotNative(): NativeSnapshot {
    return {
        source: oai_settings.chat_completion_source,
        custom_url: String(oai_settings.custom_url || ''),
        custom_model: String(oai_settings.custom_model || ''),
        custom_include_body: String(oai_settings.custom_include_body || ''),
        custom_exclude_body: String(oai_settings.custom_exclude_body || ''),
        custom_include_headers: String(oai_settings.custom_include_headers || ''),
        reverse_proxy: String(oai_settings.reverse_proxy || ''),
        claude_model: String(oai_settings.claude_model || ''),
        google_model: String(oai_settings.google_model || ''),
        proxy_password: String(oai_settings.proxy_password || ''),
    };
}

export function restoreNative(snapshot: NativeSnapshot): void {
    oai_settings.custom_url = snapshot.custom_url;
    oai_settings.custom_model = snapshot.custom_model;
    oai_settings.custom_include_body = snapshot.custom_include_body;
    oai_settings.custom_exclude_body = snapshot.custom_exclude_body;
    oai_settings.custom_include_headers = snapshot.custom_include_headers;
    oai_settings.reverse_proxy = snapshot.reverse_proxy;
    oai_settings.claude_model = snapshot.claude_model;
    oai_settings.google_model = snapshot.google_model;
    oai_settings.proxy_password = snapshot.proxy_password;
    $('#custom_api_url_text').val(snapshot.custom_url).trigger('input');
    $('#custom_model_id').val(snapshot.custom_model).trigger('input');
    $('#openai_reverse_proxy').val(snapshot.reverse_proxy).trigger('input');
    $('#openai_proxy_password').val(snapshot.proxy_password).trigger('input');
    $('#model_claude_select').val(snapshot.claude_model).trigger('change');
    $('#model_google_select').val(snapshot.google_model).trigger('change');
    $('#chat_completion_source').val(snapshot.source).trigger('change');
}
