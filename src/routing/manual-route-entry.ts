// 手动路由按钮：注入发送按钮旁边，点击后按当前分组逻辑模型选一个 Vendor/Key，
// 写进 ST 原生连接字段并提示结果。下一次生成时拦截模式仍会重新随机路由。

import { activeGroup, groups, routingSettings, vendors } from '../settings/access.js';
import { runtimeState } from '../state.js';
import { debugLog } from '../debug.js';
import { resolveManualRouteOutcome } from './manual-route.js';
import { applyVendorConnection } from './apply-provider.js';

export function runManualRoute(): void {
    const outcome = resolveManualRouteOutcome({
        routingEnabled: routingSettings().enabled,
        activeGroupId: activeGroup()?.id ?? null,
        groups: groups(),
        vendors: vendors(),
    });
    if (outcome.unit) {
        applyVendorConnection(outcome.unit.vendor, outcome.unit.entry.apiKey, outcome.unit.realModel);
        debugLog('manual route applied', {
            vendorName: outcome.unit.vendor.name,
            entryLabel: outcome.unit.entry.label,
            realModel: outcome.unit.realModel,
        });
    }
    toastr[outcome.toastrType](outcome.toastrText, outcome.toastrTitle, { timeOut: 8000 });
}

export function makeManualRouteEntry(): JQuery<HTMLElement> {
    return $('<div class="quicker-api__quick-entry quicker-api__manual-route-entry fa-solid fa-shuffle interactable" role="button" tabindex="0" aria-label="ST Api Router 手动路由" title="ST Api Router 手动路由"></div>')
        .attr('id', 'quicker_api_manual_route')
        .on('click.quickerApi', event => {
            event.stopPropagation();
            debugLog('manual route entry clicked');
            runManualRoute();
        })
        .on('keydown.quickerApi', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                runManualRoute();
            }
        });
}

export function ensureManualRouteEntry(): void {
    if (runtimeState.extensionDisabled || runtimeState.teardownPending) return;
    if (document.getElementById('quicker_api_manual_route')) return;
    const sendButton = document.getElementById('send_but');
    const entry = makeManualRouteEntry()[0];
    sendButton?.parentElement?.insertBefore(entry, sendButton);
}

export function removeManualRouteEntry(): void {
    $('#quicker_api_manual_route').remove();
}