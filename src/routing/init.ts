// 路由接线：失败观察器 + 生成生命周期钩子 + 手动路由入口。
// initRouting 由 lifecycle 调用；teardownRouting 在 teardown 时清理。

import { chat, eventSource, event_types, saveSettingsDebounced } from '@sillytavern/script';
import { chat_completion_sources } from '@sillytavern/scripts/openai';
import { FORMATS } from '../constants.js';
import { activeGroup, groups, ignoredModels, logicalModels, mappingRules, routingSettings, settings, vendors } from '../settings/access.js';
import { createFailureObserver } from './failure-observer.js';
import { appendModelObservation, MODEL_OBSERVATION_RECORDED_EVENT } from '../domain/model-health.js';
import { createRoutingHooks } from './hooks.js';
import { ensureManualRouteEntry, removeManualRouteEntry, setManualRouteLocker } from './manual-route-entry.js';
import { BLOCKED_SOURCE_PRESET_TRANSITION, BLOCKED_SOURCE_SAFETY } from '../domain/generation-guard.js';
import { runtimeState } from '../state.js';
import { debugLog } from '../debug.js';

/** 生成前阻断：预设切换中 / 密钥安全阻断。 */
function guardGenerationWhenBlocked(generateData: Record<string, any>): void {
    if (runtimeState.extensionDisabled || !generateData || typeof generateData !== 'object') return;
    if (runtimeState.presetTransitionBlocked) {
        generateData.chat_completion_source = BLOCKED_SOURCE_PRESET_TRANSITION;
        generateData.custom_url = '';
        generateData.reverse_proxy = '';
        debugLog('guardGenerationWhenBlocked blocked by preset transition', { source: generateData.chat_completion_source });
        toastr.error('Quicker Api 正在安全切换预设凭据，本次生成已阻断。');
        return;
    }
    const format = Object.values(FORMATS).find(config => config.source === generateData.chat_completion_source);
    if (!format) return;
    const usesProxyCredential = format.source !== chat_completion_sources.CUSTOM && Boolean(generateData.reverse_proxy);
    if (usesProxyCredential || !settings().blockedSecretKeys[format.secretKey]) return;
    generateData.chat_completion_source = BLOCKED_SOURCE_SAFETY;
    generateData.custom_url = '';
    generateData.reverse_proxy = '';
    debugLog('guardGenerationWhenBlocked blocked by secret', { source: generateData.chat_completion_source, secretKey: format.secretKey });
    toastr.error(settings().blockedSecretKeys[format.secretKey]);
}

interface RoutingRegistration {
    teardown(): void;
}

let registration: RoutingRegistration | null = null;

export function initRouting(): void {
    debugLog('initRouting', { hasRegistration: Boolean(registration) });
    if (registration) return;
    const failureObserver = createFailureObserver();
    failureObserver.install();
    const hooks = createRoutingHooks({
        getVendors: vendors,
        getGroups: groups,
        getLogicalModels: logicalModels,
        getActiveGroupId: () => activeGroup()?.id ?? null,
        getRouting: routingSettings,
        beginGeneration: () => failureObserver.begin(),
        endGeneration: () => {
            failureObserver.observeResponseText(chat[chat.length - 1]?.mes);
            return failureObserver.end();
        },
        recordObservation: (record) => {
            settings().observationHistory = appendModelObservation(settings().observationHistory, record);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent(MODEL_OBSERVATION_RECORDED_EVENT));
            }
        },
    });
    eventSource.on(event_types.GENERATION_STARTED, hooks.onGenerationStarted);
    eventSource.on(event_types.GENERATION_ENDED, hooks.onGenerationEnded);
    eventSource.on(event_types.GENERATION_STOPPED, hooks.onGenerationStopped);
    // 生成阻断（预设切换中 / 密钥安全阻断）— 必须在路由拦截之前，后注册的 makeLast 更晚运行
    eventSource.makeLast(event_types.CHAT_COMPLETION_SETTINGS_READY, guardGenerationWhenBlocked);
    // 拦截模式：在 ST 组装好请求数据后、发出前，直接改 generateData
    if (event_types.CHAT_COMPLETION_SETTINGS_READY) {
        eventSource.makeLast(event_types.CHAT_COMPLETION_SETTINGS_READY, hooks.onChatCompletionSettingsReady);
    }
    setManualRouteLocker(unit => hooks.lockManualRoute(unit));
    ensureManualRouteEntry();
    registration = {
        teardown() {
            debugLog('routing teardown');
            eventSource.removeListener(event_types.GENERATION_STARTED, hooks.onGenerationStarted);
            eventSource.removeListener(event_types.GENERATION_ENDED, hooks.onGenerationEnded);
            eventSource.removeListener(event_types.GENERATION_STOPPED, hooks.onGenerationStopped);
            if (event_types.CHAT_COMPLETION_SETTINGS_READY) {
                eventSource.removeListener(event_types.CHAT_COMPLETION_SETTINGS_READY, hooks.onChatCompletionSettingsReady);
                eventSource.removeListener(event_types.CHAT_COMPLETION_SETTINGS_READY, guardGenerationWhenBlocked);
            }
            failureObserver.uninstall();
            removeManualRouteEntry();
            setManualRouteLocker(null);
        },
    };
    debugLog('initRouting done');
}

export function teardownRouting(): void {
    registration?.teardown();
    registration = null;
}
