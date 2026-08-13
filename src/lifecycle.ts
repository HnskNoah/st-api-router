// 生命周期：初始化、初始选中恢复、teardown、冲突检测、DOM 观察

import { eventSource, event_types, saveSettingsDebounced } from '@sillytavern/script';
import { runtimeState, ownedPopups, activeFetchControllers, nativePresetCaptureHandlers } from './state.js';
import { settings, profiles, currentPresetName } from './settings/access.js';
import { initializeSettings } from './settings/initialize.js';
import { clearKeyEditor, renderProfiles, renderStatus, setOperationControlsDisabled } from './ui/render.js';
import { cancelOwnedPopups } from './popups.js';
import { enqueueOperation } from './operation-queue.js';
import { readAuthoritativeSecretState } from './secrets/api.js';
import { applyProfile } from './apply/profile.js';
import { beginPresetTransition, endPresetTransition } from './presets/transition.js';
import { handleNativePresetChangeBefore, handleNativePresetChange, handlePresetRenamed, handlePresetDeleted } from './presets/hooks.js';
import { guardGenerationWhenBlocked } from './apply/guard.js';
import { closeQuickActionMenu } from './quick-actions/menu-core.js';
import { ensureQuickActionEntries, scheduleQuickActionEntries } from './quick-actions/menu.js';
import { normalizeQuickActionPlacement } from './domain/quick-action.js';
import { profileMatchesNative } from './native/match.js';
import { bindEvents } from './events.js';
import { toolbarHtml } from './ui/toolbar.js';
import { updatePanelVisibility } from './ui/render.js';
import { initRouting, teardownRouting } from './routing/init.js';

function findInitialProfile() {
    const currentPreset = currentPresetName();
    const boundId = currentPreset ? settings().presetBindings[currentPreset] : '';
    let target = profiles().find(profile => profile.id === settings().selectedProfileId) || null;
    if (!target) target = profiles().find(profile => profile.id === boundId) || null;
    if (!target) target = profiles().find(profile => profile.id === settings().activeProfileId) || null;
    if (!target) target = profiles().find(profile => profileMatchesNative(profile)) || null;
    if (!target && profiles().length === 1) target = profiles()[0];
    return target;
}

export async function restoreInitialProfileSelection(): Promise<void> {
    const target = findInitialProfile();
    settings().selectedProfileId = target?.id || null;
    settings().activeProfileId = null;
    saveSettingsDebounced();
    renderProfiles(target?.id || null);
    if (!target) return;
    const generation = ++runtimeState.profileSelectionGeneration;
    beginPresetTransition();
    try {
        const applied = await applyProfile(target, generation, true);
        if (!applied) renderStatus('所选 Profile 未应用。');
    } finally {
        endPresetTransition();
    }
}

export function detectConflict(): boolean {
    if (!document.getElementById('apihub_container')) return false;
    toastr.warning('Quicker Api 与 API Hub 都会管理连接；Quicker Api 已停止注入以避免冲突。');
    return true;
}

export function watchForDomChanges(): void {
    runtimeState.quickActionObserver = new MutationObserver(mutations => {
        const elementNodes = mutations.flatMap(mutation => [...mutation.addedNodes, ...mutation.removedNodes])
            .filter(node => node.nodeType === Node.ELEMENT_NODE) as Element[];
        const apiHubAdded = elementNodes.some(node => node.id === 'apihub_container' || node.querySelector?.('#apihub_container'));
        if (apiHubAdded || document.getElementById('apihub_container')) {
            void teardownQuickerApi().then(didTeardown => {
                if (didTeardown) toastr.warning('检测到 API Hub，Quicker Api 已在安全回滚完成后停用。');
            });
            return;
        }
        const placement = normalizeQuickActionPlacement(settings().quickActionPlacement);
        const entryMissing = placement === 'disabled'
            ? false
            : placement === 'leftSendForm'
                ? !document.getElementById('quicker_api_quick_left')
                : placement === 'rightSendForm'
                    ? !document.getElementById('quicker_api_quick_right')
                    : !document.querySelector('[data-quicker-api-qr-entry]');
        const qrChanged = placement === 'qrButtons' && elementNodes.some(node =>
            node.matches?.('.qr--buttons, [data-quicker-api-qr-entry], #qr--bar, #qr--popout')
            || node.querySelector?.('.qr--buttons, [data-quicker-api-qr-entry], #qr--bar, #qr--popout'));
        if (entryMissing || qrChanged) scheduleQuickActionEntries();
    });
    runtimeState.quickActionObserver.observe(document.body, { childList: true, subtree: true });
}

export async function teardownQuickerApi(): Promise<boolean> {
    if (runtimeState.teardownPending || runtimeState.extensionDisabled) return false;
    runtimeState.teardownPending = true;
    beginPresetTransition();
    setOperationControlsDisabled(true);
    runtimeState.quickActionObserver?.disconnect();
    runtimeState.quickActionObserver = null;
    closeQuickActionMenu();
    runtimeState.quickActionPlacementPopup = null;
    $('#quicker_api_quick_left, #quicker_api_quick_right, [data-quicker-api-qr-entry]').remove();
    runtimeState.quickPresetWaitCancel?.();
    runtimeState.quickPresetWaitCancel = null;
    await cancelOwnedPopups();
    for (const controller of [...activeFetchControllers]) controller.abort();
    runtimeState.quickActionTransaction++;
    runtimeState.profileSelectionGeneration++;
    clearTimeout(runtimeState.presetChangeTimer ?? undefined);
    runtimeState.presetChangeTimer = null;

    await runtimeState.quickActionQueue.catch(() => undefined);
    let stableQueue: Promise<unknown> | null = null;
    do {
        stableQueue = runtimeState.operationQueue;
        await stableQueue.catch(() => undefined);
        await new Promise(resolve => setTimeout(resolve, 0));
    } while (runtimeState.operationQueue !== stableQueue);

    runtimeState.extensionDisabled = true;
    runtimeState.teardownPending = false;
    runtimeState.quickActionBlockingToken = 0;
    endPresetTransition({ force: true });
    runtimeState.quickActionRenderPending = false;
    clearKeyEditor();
    $('#quicker_api').remove();
    teardownRouting();
    $('#custom_form, #claude_form, #makersuite_form').removeClass('quicker-api__native-provider');
    $(document).off('.quickerApi').off('.quickerApiMenu');
    $(window).off('.quickerApiMenu');
    if (globalThis.visualViewport) $(globalThis.visualViewport).off('.quickerApiMenu');
    $('#custom_api_url_text, #custom_model_id, #openai_reverse_proxy, #model_claude_select, #model_google_select, #chat_completion_source').off('.quickerApi');
    eventSource.removeListener(event_types.OAI_PRESET_CHANGED_BEFORE, handleNativePresetChangeBefore);
    eventSource.removeListener(event_types.OAI_PRESET_CHANGED_AFTER, handleNativePresetChange);
    eventSource.removeListener(event_types.PRESET_RENAMED, handlePresetRenamed);
    eventSource.removeListener(event_types.PRESET_DELETED, handlePresetDeleted);
    eventSource.removeListener(event_types.CHAT_COMPLETION_SETTINGS_READY, guardGenerationWhenBlocked);
    const updateButton = document.getElementById('update_oai_preset');
    const createButton = document.getElementById('new_oai_preset');
    if (nativePresetCaptureHandlers.update) updateButton?.removeEventListener('click', nativePresetCaptureHandlers.update, true);
    if (nativePresetCaptureHandlers.create) createButton?.removeEventListener('click', nativePresetCaptureHandlers.create, true);
    delete nativePresetCaptureHandlers.update;
    delete nativePresetCaptureHandlers.create;
    runtimeState.nativePresetSaveIntent = null;
    if (runtimeState.presetObservedFetch && globalThis.fetch === runtimeState.presetObservedFetch) globalThis.fetch = runtimeState.originalFetch as typeof fetch;
    runtimeState.originalFetch = null;
    runtimeState.presetObservedFetch = null;
    return true;
}

export function initQuickerApi(): void {
    if (!initializeSettings() || detectConflict()) return;
    const apiPanel = document.getElementById('openai_api');
    if (!apiPanel) {
        console.warn('[QuickerApi] #openai_api not found; extension was not initialized.');
        return;
    }
    if (document.getElementById('quicker_api')) return;
    $('#chat_completion_source').after(toolbarHtml());
    updatePanelVisibility();
    bindEvents();
    renderProfiles();
    initRouting();
    watchForDomChanges();
    void enqueueOperation(async () => {
        if (!await readAuthoritativeSecretState()) toastr.warning('Quicker Api 暂时无法读取权威密钥状态；切换将保持阻断。');
        await restoreInitialProfileSelection();
    });
    console.log('[QuickerApi] Extension loaded');
}
