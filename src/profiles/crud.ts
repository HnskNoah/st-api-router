// Profile CRUD 与保存流程

import { saveSettingsDebounced } from '@sillytavern/script';
import { POPUP_TYPE } from '@sillytavern/scripts/popup';
import { FORMATS } from '../constants.js';
import { settings, profiles, selectedProfile, currentPresetName } from '../settings/access.js';
import { normalizeProfile, uniqueName } from '../domain/profile.js';
import { normalizeModelList } from '../utils/model-list.js';
import { makeId } from '../utils/id.js';
import { normalizeFormat } from '../utils/format.js';
import { normalizeText } from '../utils/text.js';
import { callQuickerPopup, promptName } from '../popups.js';
import { readAuthoritativeSecretState } from '../secrets/api.js';
import { syncEditorConnectionToNative } from '../native/fields.js';
import { captureNativeProfile } from './capture.js';
import { saveAndBindInputKey } from './key-editor.js';
import {
    renderProfileEditor, renderProfiles, renderStatus, updateCredentialEditor,
    setStatus, clearKeyEditor,
} from '../ui/render.js';

export function createProfile(): void {
    clearKeyEditor();
    settings().selectedProfileId = null;
    saveSettingsDebounced();
    const select = $('#quicker_api_profile_select');
    select.find('option[value=""]').text('— 新建 API 配置（未保存） —');
    select.val('');
    renderProfileEditor(null);
    updateCredentialEditor(null);
    setStatus('正在新建 API 配置；填写后请点击"保存 API 配置"。', 'warning');
    toastr.info('已进入新建模式；填写连接信息后点击"保存 API 配置"即可创建 Profile。');
    $('#quicker_api_url').trigger('focus');
}

export async function saveSelectedProfile(): Promise<void> {
    let current = selectedProfile();
    const isNew = !current;
    const previousEndpoint = normalizeText(current?.endpoint);
    const format = normalizeFormat($('#quicker_api_format').val());
    const editorEndpoint = normalizeText($('#quicker_api_url').val());
    if (format === 'openai' && !editorEndpoint) {
        toastr.warning('OpenAI Compatible URL 不能为空。');
        return;
    }
    if (!current) {
        const name = await promptName('输入新 API 配置名称：', `${FORMATS[format].label} ${profiles().length + 1}`);
        if (!name) return;
        current = normalizeProfile({ id: makeId(), name: uniqueName(name, profiles()), format });
    }
    const config = FORMATS[format];
    const proxyMode = format !== 'openai' && Boolean(editorEndpoint);
    if (!proxyMode && !await readAuthoritativeSecretState()) {
        toastr.error('无法读取权威密钥状态，已取消保存 API 配置。');
        return;
    }
    const keyValue = normalizeText($('#quicker_api_key_input').val());
    let captureBase = current;
    if (keyValue) {
        const credentialDraft = normalizeProfile({ ...structuredClone(current), format });
        if (!await saveAndBindInputKey(credentialDraft, format, editorEndpoint)) return;
        captureBase = credentialDraft;
    }
    syncEditorConnectionToNative();
    Object.assign(current, captureNativeProfile(current.name, format, captureBase));
    if (format === 'openai') {
        current.availableModels = normalizeModelList([...(current.availableModels || []), current.model]);
        if (!isNew && previousEndpoint !== normalizeText(current.endpoint)) {
            current.fetchedModels = [];
            current.fetchedFromEndpoint = '';
        } else {
            current.fetchedModels = normalizeModelList(current.fetchedModels);
        }
    }
    if (isNew) profiles().push(current);
    settings().selectedProfileId = current.id;
    settings().activeProfileId = current.id;
    const presetName = currentPresetName();
    if (presetName) settings().presetBindings[presetName] = current.id;
    saveSettingsDebounced();
    renderProfiles(current.id);
    toastr.success('API 配置已保存。');
}

export async function renameSelectedProfile(): Promise<void> {
    const profile = selectedProfile();
    if (!profile) return;
    const name = await promptName('输入新的配置名称：', profile.name);
    if (!name) return;
    profile.name = uniqueName(name, profiles(), profile.id);
    profile.updatedAt = new Date().toISOString();
    saveSettingsDebounced();
    renderProfiles(profile.id);
}

export async function copySelectedProfile(): Promise<void> {
    const profile = selectedProfile();
    if (!profile) return;
    const name = await promptName('输入复制配置的名称：', `${profile.name} 副本`);
    if (!name) return;
    const copy = normalizeProfile({ ...structuredClone(profile), id: makeId(), name: uniqueName(name, profiles(), profile.id), updatedAt: new Date().toISOString() });
    profiles().push(copy);
    settings().selectedProfileId = copy.id;
    saveSettingsDebounced();
    renderProfiles(copy.id);
    toastr.success('配置已复制。');
}

export async function deleteSelectedProfile(): Promise<void> {
    const profile = selectedProfile();
    if (!profile) return;
    const content = $('<div>').append($('<p>').text(`删除 Profile"${profile.name}"？`), $('<p>').text('不会删除任何原生密钥；相关原生预设绑定会被解除。'));
    if (!await callQuickerPopup(content, POPUP_TYPE.CONFIRM)) return;
    settings().profiles = profiles().filter(item => item.id !== profile.id);
    for (const [name, id] of Object.entries(settings().presetBindings)) {
        if (id === profile.id) delete settings().presetBindings[name];
    }
    if (settings().activeProfileId === profile.id) settings().activeProfileId = null;
    if (settings().selectedProfileId === profile.id) settings().selectedProfileId = null;
    saveSettingsDebounced();
    renderProfiles();
}
