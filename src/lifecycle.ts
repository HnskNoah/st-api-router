// 生命周期：初始化、冲突检测、DOM 观察、teardown

import { eventSource, event_types, saveSettingsDebounced, setOnlineStatus } from '@sillytavern/script';
import { oai_settings } from '@sillytavern/scripts/openai';
import { EMPTY_CUSTOM_CONNECTION } from './constants.js';
import { runtimeState, ownedPopups, activeFetchControllers, beginPresetTransition, endPresetTransition } from './state.js';
import { settings } from './settings/access.js';
import { initializeSettings } from './settings/initialize.js';
import { enqueueOperation } from './operation-queue.js';
import { readAuthoritativeSecretState } from './secrets/api.js';
import { closeQuickActionMenu } from './quick-actions/menu-core.js';
import { ensureQuickActionEntries, scheduleQuickActionEntries } from './quick-actions/menu.js';
import { ensureManualRouteEntry } from './routing/manual-route-entry.js';
import { normalizeQuickActionPlacement } from './domain/quick-action.js';
import { initRouting, teardownRouting } from './routing/init.js';
import { initDebugLog, debugLog, installFetchLogging } from './debug.js';

export function detectConflict(): boolean {
    if (!document.getElementById('apihub_container')) return false;
    toastr.warning('Quicker Api 与 API Hub 都会管理连接；Quicker Api 已停止注入以避免冲突。');
    return true;
}

/** 启动时把 ST 连接置为空地址占位：custom 空 URL，避免 "自动连接上次服务器" 连到上次路由/手动配置的 vendor。 */
function ensureEmptyConnectionPlaceholder(): void {
    Object.assign(oai_settings, EMPTY_CUSTOM_CONNECTION);
    // 只改下拉显示，不 trigger('change')——避免触发 ST reconnect / /v1/models
    const sourceEl = $('#chat_completion_source');
    if (sourceEl.length && String(sourceEl.val() ?? '') !== EMPTY_CUSTOM_CONNECTION.chat_completion_source) {
        sourceEl.val(EMPTY_CUSTOM_CONNECTION.chat_completion_source);
    }
    saveSettingsDebounced();
    setOnlineStatus('Valid');
    debugLog('empty connection placeholder applied');
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
        if (!document.getElementById('quicker_api_manual_route')) ensureManualRouteEntry();
    });
    runtimeState.quickActionObserver.observe(document.body, { childList: true, subtree: true });
}

export async function teardownQuickerApi(): Promise<boolean> {
    debugLog('teardownQuickerApi start', { extensionDisabled: runtimeState.extensionDisabled, teardownPending: runtimeState.teardownPending });
    if (runtimeState.teardownPending || runtimeState.extensionDisabled) return false;
    runtimeState.teardownPending = true;
    beginPresetTransition();
    runtimeState.quickActionObserver?.disconnect();
    runtimeState.quickActionObserver = null;
    closeQuickActionMenu();
    runtimeState.quickActionPlacementPopup = null;
    $('#quicker_api_quick_left, #quicker_api_quick_right, [data-quicker-api-qr-entry]').remove();
    runtimeState.quickPresetWaitCancel?.();
    runtimeState.quickPresetWaitCancel = null;
    await Promise.allSettled([...ownedPopups].map(popup => (popup as any).completeCancelled?.()));
    for (const controller of [...activeFetchControllers]) controller.abort();
    runtimeState.quickActionTransaction++;

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
    teardownRouting();
    $(document).off('.quickerApi').off('.quickerApiMenu');
    $(window).off('.quickerApiMenu');
    if (globalThis.visualViewport) $(globalThis.visualViewport).off('.quickerApiMenu');
    $('#custom_api_url_text, #custom_model_id, #openai_reverse_proxy, #model_claude_select, #model_google_select, #chat_completion_source').off('.quickerApi');
    debugLog('teardownQuickerApi done');
    return true;
}

export function initQuickerApi(): void {
    initDebugLog();
    installFetchLogging();
    debugLog('initQuickerApi start');
    if (!initializeSettings() || detectConflict()) {
        debugLog('initQuickerApi aborted: settings/conflict');
        return;
    }
    const apiPanel = document.getElementById('openai_api');
    if (!apiPanel) {
        console.warn('[QuickerApi] #openai_api not found; extension was not initialized.');
        debugLog('initQuickerApi aborted: #openai_api missing');
        return;
    }
    // 启动置空地址占位：挡住 auto_connect 连上次 vendor（拦截模式接管真实连接）
    ensureEmptyConnectionPlaceholder();
    initRouting();
    ensureQuickActionEntries();
    watchForDomChanges();
    void enqueueOperation(async () => {
        if (!await readAuthoritativeSecretState()) toastr.warning('Quicker Api 暂时无法读取权威密钥状态；切换将保持阻断。');
    });
    debugLog('initQuickerApi done');
    console.log('[QuickerApi] Extension loaded');
}