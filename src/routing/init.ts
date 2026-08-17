// 路由接线：失败观察器 + 生成生命周期钩子 + 路由 UI 面板。
// initRouting 由 lifecycle 在 Profile 面板渲染后调用；teardownRouting 在 teardown 时清理。

import { eventSource, event_types, saveSettingsDebounced } from '@sillytavern/script';
import { activeGroup, groups, logicalModels, routingSettings, settings, vendors } from '../settings/access.js';
import { createFailureObserver } from './failure-observer.js';
import { createRoutingHooks } from './hooks.js';
import { initRoutingUI } from './ui.js';
import { ensureManualRouteEntry, removeManualRouteEntry } from './manual-route-entry.js';
import { debugLog } from '../debug.js';

interface RoutingRegistration {
    teardown(): void;
}

let registration: RoutingRegistration | null = null;

export function initRouting(): void {
    debugLog('initRouting', { hasRegistration: Boolean(registration), panelPresent: Boolean(document.getElementById('st_router_panel')) });
    if (registration || document.getElementById('st_router_panel')) return;
    const failureObserver = createFailureObserver();
    failureObserver.install();
    const hooks = createRoutingHooks({
        getVendors: vendors,
        getGroups: groups,
        getActiveGroupId: () => activeGroup()?.id ?? null,
        getRouting: routingSettings,
        beginGeneration: () => failureObserver.begin(),
        endGeneration: () => failureObserver.end(),
    });
    eventSource.on(event_types.GENERATION_STARTED, hooks.onGenerationStarted);
    eventSource.on(event_types.GENERATION_ENDED, hooks.onGenerationEnded);
    eventSource.on(event_types.GENERATION_STOPPED, hooks.onGenerationStopped);
    // 拦截模式：在 ST 组装好请求数据后、发出前，直接改 generateData
    if (event_types.CHAT_COMPLETION_SETTINGS_READY) {
        eventSource.makeLast(event_types.CHAT_COMPLETION_SETTINGS_READY, hooks.onChatCompletionSettingsReady);
    }
    initRoutingUI({
        getVendors: vendors,
        getGroups: groups,
        getLogicalModels: logicalModels,
        getActiveGroupId: () => activeGroup()?.id ?? null,
        setActiveGroupId: id => {
            settings().activeGroupId = id;
            saveSettingsDebounced();
        },
        getRouting: routingSettings,
        save: () => saveSettingsDebounced(),
    });
    ensureManualRouteEntry();
    registration = {
        teardown() {
            debugLog('routing teardown');
            eventSource.removeListener(event_types.GENERATION_STARTED, hooks.onGenerationStarted);
            eventSource.removeListener(event_types.GENERATION_ENDED, hooks.onGenerationEnded);
            eventSource.removeListener(event_types.GENERATION_STOPPED, hooks.onGenerationStopped);
            if (event_types.CHAT_COMPLETION_SETTINGS_READY) {
                eventSource.removeListener(event_types.CHAT_COMPLETION_SETTINGS_READY, hooks.onChatCompletionSettingsReady);
            }
            failureObserver.uninstall();
            removeManualRouteEntry();
            $('#st_router_panel').remove();
        },
    };
    debugLog('initRouting done');
}

export function teardownRouting(): void {
    registration?.teardown();
    registration = null;
}
