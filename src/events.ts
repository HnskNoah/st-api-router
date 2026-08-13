// 事件绑定（按域拆分，来自 index.js bindEvents）

import { eventSource, event_types } from '@sillytavern/script';
import { oai_settings } from '@sillytavern/scripts/openai';
import { runtimeState } from './state.js';
import { settings, profiles, selectedProfile } from './settings/access.js';
import { normalizeFormat } from './utils/format.js';
import { FORMATS } from './constants.js';
import { saveSettingsDebounced } from '@sillytavern/script';
import { clearKeyEditor, renderModelControl, renderProfileEditor, renderProfiles, renderStatus, updateCredentialEditor, updatePanelVisibility } from './ui/render.js';
import { syncEditorModelToNative } from './native/fields.js';
import { enqueueOperation } from './operation-queue.js';
import { applyProfileById } from './quick-actions/runner.js';
import { handleNativePresetChangeBefore, handleNativePresetChange, handlePresetRenamed, handlePresetDeleted } from './presets/hooks.js';
import { guardGenerationWhenBlocked } from './apply/guard.js';
import { createProfile, saveSelectedProfile, renameSelectedProfile, copySelectedProfile, deleteSelectedProfile } from './profiles/crud.js';
import { importNativeProfile } from './import/native.js';
import { revealBoundSecret, copyBoundSecret } from './profiles/key-editor.js';
import { addCustomModel, fetchCustomModels } from './models/fetch.js';
import { manageCustomModels } from './models/manage.js';
import { manageQuickActions } from './quick-actions/manager.js';
import { ensureQuickActionEntries } from './quick-actions/menu.js';
import { installPresetSaveObserver, bindNativePresetSaveCapture } from './presets/save-observer.js';
import { normalizeText } from './utils/text.js';

function bindProfileSelect(): void {
    $('#quicker_api_profile_select').on('change', function () {
        clearKeyEditor();
        const profile = profiles().find(item => item.id === String($(this).val())) || null;
        settings().selectedProfileId = profile?.id || null;
        saveSettingsDebounced();
        if (!profile) return renderStatus();
        $('#quicker_api_format').val(profile.format);
        void applyProfileById(profile.id, runtimeState.quickActionTransaction, { applyModel: true, manageTransition: true });
    });
}

function bindFormatSelect(): void {
    $('#quicker_api_format').on('change', function () {
        clearKeyEditor();
        const format = normalizeFormat($(this).val());
        const source = FORMATS[format].source;
        if (oai_settings.chat_completion_source !== source) $('#chat_completion_source').val(source).trigger('change');
        $('#quicker_api_url').val(String(oai_settings[FORMATS[format].endpointField] || ''));
        const profile = selectedProfile()?.format === format ? selectedProfile() : null;
        renderModelControl(profile);
        updateCredentialEditor(profile);
        renderStatus();
    });
}

function bindToolbarButtons(): void {
    $('#quicker_api_new').on('click', createProfile);
    $('#quicker_api_save').on('click', () => void enqueueOperation(saveSelectedProfile));
    $('#quicker_api_rename').on('click', renameSelectedProfile);
    $('#quicker_api_copy').on('click', copySelectedProfile);
    $('#quicker_api_import_native').on('click', () => void enqueueOperation(importNativeProfile));
    $('#quicker_api_delete').on('click', deleteSelectedProfile);
    $('#quicker_api_reveal_key').on('click', () => void enqueueOperation(revealBoundSecret));
    $('#quicker_api_copy_key').on('click', () => void enqueueOperation(copyBoundSecret));
}

function bindSourceEvents(): void {
    eventSource.on(event_types.OAI_PRESET_CHANGED_BEFORE, handleNativePresetChangeBefore);
    eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, handleNativePresetChange);
    eventSource.on(event_types.PRESET_RENAMED, handlePresetRenamed);
    eventSource.on(event_types.PRESET_DELETED, handlePresetDeleted);
    eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, guardGenerationWhenBlocked);
    eventSource.makeLast(event_types.CHAT_COMPLETION_SETTINGS_READY, guardGenerationWhenBlocked);
}

function bindEditorInputs(): void {
    $('#quicker_api_url').on('input', function () {
        const format = normalizeFormat($('#quicker_api_format').val());
        const proxyMode = format !== 'openai' && Boolean(normalizeText($(this).val()));
        $('#quicker_api_native_key_manager').attr('data-key', FORMATS[format].secretKey).data('key', FORMATS[format].secretKey).toggle(!proxyMode);
        renderStatus();
    });
    $('#quicker_api_key_input').on('input', () => renderStatus());
}

function bindDocumentEvents(): void {
    $(document).on('change.quickerApi', '#quicker_api_custom_model, #quicker_api_provider_model', () => {
        syncEditorModelToNative();
        renderStatus();
    });
    $(document).on('click.quickerApi', '#quicker_api_add_model', addCustomModel);
    $(document).on('click.quickerApi', '#quicker_api_fetch_models', () => void enqueueOperation(fetchCustomModels));
    $(document).on('click.quickerApi', '#quicker_api_manage_models', manageCustomModels);
    $(document).on('click.quickerApi', '.quicker-api__manage-actions', () => void manageQuickActions());
    $('#chat_completion_source').on('change.quickerApi', function () {
        updatePanelVisibility();
        const entry = Object.entries(FORMATS).find(([, config]) => config.source === String($(this).val()));
        if (!entry) return;
        $('#quicker_api_format').val(entry[0]);
        const profile = selectedProfile()?.format === entry[0] ? selectedProfile() : null;
        renderProfileEditor(profile);
        updateCredentialEditor(profile);
        renderStatus();
    });
    $(document).on('click.quickerApi', '.secretKeyManager button, .secretKeyManager .menu_button', () => setTimeout(renderStatus, 250));
}

export function bindEvents(): void {
    installPresetSaveObserver();
    bindNativePresetSaveCapture();
    bindProfileSelect();
    bindFormatSelect();
    bindToolbarButtons();
    bindSourceEvents();
    bindEditorInputs();
    bindDocumentEvents();
    ensureQuickActionEntries();
}
