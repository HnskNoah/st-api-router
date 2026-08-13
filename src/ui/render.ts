// 渲染（叶子节点：被绝大多数模块依赖，禁止向上依赖）

import { oai_settings } from '@sillytavern/scripts/openai';
import { FORMATS, SUPPORTED_SOURCES } from '../constants.js';
import { runtimeState } from '../state.js';
import { settings, profiles, selectedProfile, currentPresetName, getBlockedSecretMessage, hasBlockedSecrets } from '../settings/access.js';
import { getEditorModel } from '../native/fields.js';
import { profileHasCredential } from '../native/match.js';
import { normalizeFormat } from '../utils/format.js';
import { normalizeModelList } from '../utils/model-list.js';
import { normalizeText } from '../utils/text.js';
import { editorHasUnsavedChanges, proxyModeForFormat } from '../domain/status.js';
import type { Profile } from '../types.js';

export function setStatus(message = '', state = ''): void {
    $('#quicker_api_status').text(message).attr('data-state', state);
}

export function clearKeyEditor(placeholder = '未配置密钥'): void {
    $('#quicker_api_key_input').val('').attr('type', 'password').attr('placeholder', placeholder);
    $('#quicker_api_reveal_key i').attr('class', 'fa-solid fa-eye-slash');
}

export function updateCredentialEditor(profile: Profile | null = selectedProfile()): void {
    const format = profile?.format || normalizeFormat($('#quicker_api_format').val());
    const config = FORMATS[format];
    const endpoint = profile?.endpoint ?? normalizeText($('#quicker_api_url').val());
    const proxyMode = proxyModeForFormat(format, endpoint);
    const hasCredential = profileHasCredential(profile, format, endpoint);
    const placeholder = proxyMode
        ? (hasCredential ? '已配置代理密码（点击眼睛查看）' : '未配置代理密码')
        : (hasCredential ? '已配置密钥（点击眼睛查看）' : '未配置密钥');
    clearKeyEditor(placeholder);
    $('#quicker_api_native_key_manager').attr('data-key', config.secretKey).data('key', config.secretKey).toggle(!proxyMode);
}

export function renderModelControl(profile: Profile | null = selectedProfile(), modelOverride: string | null = null): void {
    const format = normalizeFormat($('#quicker_api_format').val());
    const root = $('#quicker_api_model_control').empty();
    if (format !== 'openai') {
        const nativeSelect = $(FORMATS[format].modelInput);
        const draftSelect = $('<select id="quicker_api_provider_model" class="text_pole flex1" aria-label="Provider 模型">');
        nativeSelect.find('option').each((_, option) => { draftSelect.append($(option).clone()); });
        draftSelect.val(modelOverride ?? profile?.model ?? String(oai_settings[FORMATS[format].modelField] || ''));
        root.append(
            draftSelect,
            $('<button class="menu_button quicker-api__manage-actions" type="button" title="便捷按钮管理"><i class="fa-solid fa-bolt"></i><span>便捷按钮管理</span></button>'),
        );
        return;
    }
    const current = normalizeText(modelOverride ?? profile?.model ?? oai_settings.custom_model);
    const models = normalizeModelList([...(profile?.availableModels || []), current]);
    const select = $('<select id="quicker_api_custom_model" class="text_pole flex1" aria-label="Custom 模型">')
        .append($('<option>').val('').text('— 选择模型 —'));
    for (const model of models) select.append($('<option>').val(model).text(model));
    select.val(current);
    root.append(
        select,
        $('<button id="quicker_api_add_model" class="menu_button" type="button" title="添加并使用自定义模型"><i class="fa-solid fa-plus"></i><span>添加</span></button>'),
        $('<button id="quicker_api_fetch_models" class="menu_button" type="button" title="通过 SillyTavern status 后端获取模型"><i class="fa-solid fa-arrows-rotate"></i><span>获取模型</span></button>'),
        $('<button id="quicker_api_manage_models" class="menu_button" type="button" title="管理自定义与远端模型列表"><i class="fa-solid fa-list-check"></i><span>管理模型列表</span></button>'),
        $('<button class="menu_button quicker-api__manage-actions" type="button" title="便捷按钮管理"><i class="fa-solid fa-bolt"></i><span>便捷按钮管理</span></button>'),
    );
}

export function renderProfileEditor(profile: Profile | null = selectedProfile()): void {
    const format = profile?.format || normalizeFormat($('#quicker_api_format').val());
    $('#quicker_api_format').val(format);
    $('#quicker_api_url').val(profile?.endpoint ?? String(oai_settings[FORMATS[format].endpointField] || ''));
    renderModelControl(profile);
    runtimeState.editorModelBaseline = getEditorModel(format);
}

export function renderProfiles(preferredId: string | null = null): void {
    const select = $('#quicker_api_profile_select').empty().append($('<option>').val('').text('— 选择 API Profile —'));
    for (const profile of [...profiles()].sort((a, b) => a.name.localeCompare(b.name))) {
        select.append($('<option>').val(profile.id).text(`[${FORMATS[profile.format].label}] ${profile.name}`));
    }
    const selectedId = preferredId ?? settings().selectedProfileId ?? '';
    select.val(profiles().some(profile => profile.id === selectedId) ? selectedId : '');
    const profile = selectedProfile();
    if (profile) $('#quicker_api_format').val(profile.format);
    renderProfileEditor(profile);
    updateCredentialEditor(profile);
    renderStatus();
}

export function renderStatus(extraMessage = ''): void {
    const profile = selectedProfile();
    const presetName = currentPresetName();
    if (profile) {
        const proxyMode = proxyModeForFormat(profile.format, profile.endpoint);
        const blockedMessage = proxyMode ? '' : getBlockedSecretMessage(FORMATS[profile.format].secretKey);
        if (blockedMessage) return setStatus('安全阻断：凭据状态无法确认。', 'warning');
        if (settings().activeProfileId !== profile.id) return setStatus(extraMessage || '所选 Profile 未应用。', 'warning');
        if (editorHasUnsavedChanges(profile, {
            format: $('#quicker_api_format').val(),
            url: $('#quicker_api_url').val(),
            model: getEditorModel(),
            modelBaseline: runtimeState.editorModelBaseline,
            keyValue: $('#quicker_api_key_input').val(),
        })) return setStatus('当前修改尚未保存。', 'warning');
        if (presetName && settings().presetBindings[presetName] !== profile.id) return setStatus('当前 preset 未绑定到所选 Profile。', 'warning');
        if (!profileHasCredential(profile, profile.format, profile.endpoint)) return setStatus('当前 Profile 凭据为空。', 'warning');
        return setStatus('已保存并安全应用。');
    }
    if (hasBlockedSecrets()) return setStatus('安全阻断：凭据状态无法确认。', 'warning');
    if (presetName && !settings().presetBindings[presetName]) return setStatus('当前 preset 未绑定。', 'warning');
    setStatus(extraMessage || '所选 Profile 未应用。', 'warning');
}

export function setOperationControlsDisabled(disabled: boolean): void {
    $('#quicker_api select, #quicker_api button').prop('disabled', disabled);
}

export function updatePanelVisibility(): void {
    const supported = SUPPORTED_SOURCES.has(String($('#chat_completion_source').val()));
    $('#quicker_api').toggle(supported);
    if (supported) {
        $('#custom_form, #claude_form, #makersuite_form').addClass('quicker-api__native-provider');
    } else {
        $('#custom_form, #claude_form, #makersuite_form').removeClass('quicker-api__native-provider');
    }
}
