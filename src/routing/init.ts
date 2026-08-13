// 路由接线：失败观察器 + 生成生命周期钩子 + 路由 UI 面板。
// initRouting 由 lifecycle 在 Profile 面板渲染后调用；teardownRouting 在 teardown 时清理。

import { eventSource, event_types, saveSettingsDebounced } from '@sillytavern/script';
import { oai_settings } from '@sillytavern/scripts/openai';
import { providers, routingSettings } from '../settings/access.js';
import { createFailureObserver } from './failure-observer.js';
import { createRoutingHooks } from './hooks.js';
import { initRoutingUI } from './ui.js';
import type { Provider, RoutingSettings } from '../types.js';

interface RoutingRegistration {
    teardown(): void;
}

let registration: RoutingRegistration | null = null;

export function initRouting(): void {
    if (registration || document.getElementById('st_router_panel')) return;
    const failureObserver = createFailureObserver();
    failureObserver.install();
    const hooks = createRoutingHooks({
        getProviders: providers,
        getRouting: routingSettings,
        getCurrentModel: () => String(oai_settings.custom_model || '').trim(),
        beginGeneration: () => failureObserver.begin(),
        endGeneration: () => failureObserver.end(),
    });
    eventSource.on(event_types.GENERATION_STARTED, hooks.onGenerationStarted);
    eventSource.on(event_types.GENERATION_ENDED, hooks.onGenerationEnded);
    eventSource.on(event_types.GENERATION_STOPPED, hooks.onGenerationStopped);
    initRoutingUI({
        getProviders: providers,
        getRouting: routingSettings,
        save: () => saveSettingsDebounced(),
    });
    registration = {
        teardown() {
            eventSource.removeListener(event_types.GENERATION_STARTED, hooks.onGenerationStarted);
            eventSource.removeListener(event_types.GENERATION_ENDED, hooks.onGenerationEnded);
            eventSource.removeListener(event_types.GENERATION_STOPPED, hooks.onGenerationStopped);
            failureObserver.uninstall();
            $('#st_router_panel').remove();
        },
    };
}

export function teardownRouting(): void {
    registration?.teardown();
    registration = null;
}
