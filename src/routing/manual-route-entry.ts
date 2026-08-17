// 手动路由按钮：注入发送按钮旁边，点击后按当前分组逻辑模型只读选一个 Vendor/Key，
// 锁定到下一次生成（不记 RPM、不写 secrets、不发消息）。下一次生成消费锁定并清除。

import { activeGroup, groups, routingSettings, vendors } from '../settings/access.js';
import { runtimeState } from '../state.js';
import { debugLog } from '../debug.js';
import { resolveManualLock, manualRouteSkipMessage } from './manual-route.js';
import type { GroupRouteUnit } from '../domain/group-routing.js';

let manualRouteLocker: ((unit: GroupRouteUnit) => void) | null = null;

/** 由 initRouting 注入 hooks.lockManualRoute，避免本模块反向依赖 hooks。 */
export function setManualRouteLocker(locker: ((unit: GroupRouteUnit) => void) | null): void {
    manualRouteLocker = locker;
}

export function runManualRoute(): void {
    const result = resolveManualLock({
        routingEnabled: routingSettings().enabled,
        activeGroupId: activeGroup()?.id ?? null,
        groups: groups(),
        vendors: vendors(),
    });
    if (result.unit) {
        manualRouteLocker?.(result.unit);
        const { vendor, entry, realModel } = result.unit;
        toastr.info(`已锁定下一次生成：${vendor.name} / ${entry.label} / ${realModel}`, '手动路由', { timeOut: 8000 });
        debugLog('manual route locked via button', { vendorName: vendor.name, entryLabel: entry.label, realModel });
    } else {
        toastr.warning(manualRouteSkipMessage(result.skipReason), '手动路由', { timeOut: 8000 });
    }
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