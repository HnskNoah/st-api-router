// 便捷方案菜单：打开、入口按钮注入、DOM 变化观察

import { runtimeState } from '../state.js';
import { settings } from '../settings/access.js';
import { normalizeQuickActionPlacement, quickActionDisplayName } from '../domain/quick-action.js';
import { queueQuickAction } from './runner.js';
import { closeQuickActionMenu } from './menu-core.js';
import { manageQuickActions } from './manager.js';

export function openQuickActionMenu(anchor: HTMLElement, placement: string): void {
    if (runtimeState.quickActionMenu?.data('anchor') === anchor) return closeQuickActionMenu();
    closeQuickActionMenu();
    const actions = [...settings().quickActions].sort((a, b) => a.sequence - b.sequence);
    const menu = $('<ul class="list-group ctx-menu quicker-api__quick-menu" role="list" tabindex="-1">').data('anchor', anchor).appendTo(document.body);
    runtimeState.quickActionMenu = menu;
    const settingsItem = $('<li class="list-group-item ctx-header quicker-api__quick-manage" role="listitem" tabindex="0" data-quicker-api-actionable="true" title="便捷按钮管理">')
        .append(
            $('<div class="qr--button-icon fa-solid fa-gear">'),
            $('<div class="qr--button-label">').text('设置'),
        )
        .on('click', () => { closeQuickActionMenu(); void manageQuickActions(); });
    menu.append(settingsItem);
    if (!actions.length) menu.append($('<li class="list-group-item ctx-item quicker-api__quick-menu-empty" role="listitem" aria-disabled="true">').append(
        $('<div class="qr--button-icon fa-solid qr--hidden">'),
        $('<div class="qr--button-label">').text('暂无方案'),
    ));
    actions.forEach((action, index) => {
        const name = quickActionDisplayName(action, index);
        menu.append($('<li class="list-group-item ctx-item" role="listitem" tabindex="0" data-quicker-api-actionable="true">')
            .attr('title', name)
            .append(
                $('<div class="qr--button-icon fa-solid qr--hidden">'),
                $('<div class="qr--button-label">').text(name),
            )
            .on('click', () => { closeQuickActionMenu(); void queueQuickAction(action); }));
    });
    const actionable = () => menu.find('[data-quicker-api-actionable="true"]');
    menu.on('keydown', '[data-quicker-api-actionable="true"]', event => {
        const items = actionable();
        const index = items.index(event.currentTarget);
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.eq(next).trigger('focus');
    });
    runtimeState.quickActionPopper = globalThis.Popper?.createPopper?.(anchor, menu[0], {
        placement: placement === 'qrButtons' ? 'bottom-start' : placement === 'leftSendForm' ? 'top-start' : 'top-end',
        modifiers: [
            { name: 'offset', options: { offset: [0, 8] } },
            { name: 'preventOverflow', options: { padding: 8 } },
            { name: 'computeStyles', options: { gpuAcceleration: false } },
        ],
    }) || null;
    if (!runtimeState.quickActionPopper) {
        const rect = anchor.getBoundingClientRect();
        menu.css({ position: 'fixed', left: `${Math.max(8, Math.min(rect.left, innerWidth - (menu.outerWidth() ?? 0) - 8))}px`, top: `${Math.max(8, rect.top - (menu.outerHeight() ?? 0) - 8)}px` });
    }
    const closeOnViewport = () => closeQuickActionMenu();
    $(document).on('pointerdown.quickerApiMenu', event => {
        const target = event.target as Node;
        if (!menu[0].contains(target) && !anchor.contains(target)) closeQuickActionMenu();
    }).on('focusin.quickerApiMenu', event => {
        const target = event.target as Node;
        if (!menu[0].contains(target) && target !== anchor) closeQuickActionMenu();
    }).on('keydown.quickerApiMenu', event => {
        if (event.key === 'Escape') { event.preventDefault(); closeQuickActionMenu(); anchor.focus?.(); }
        if (event.key === 'Tab') closeQuickActionMenu();
    });
    $(window).on('resize.quickerApiMenu scroll.quickerApiMenu blur.quickerApiMenu', closeOnViewport);
    if (globalThis.visualViewport) $(globalThis.visualViewport).on('resize.quickerApiMenu scroll.quickerApiMenu', closeOnViewport);
    actionable().first().trigger('focus');
}

export function makeQuickActionEntry(id: string, placement: string): JQuery<HTMLElement> {
    const entry = placement !== 'qrButtons'
        ? $('<div class="quicker-api__quick-entry fa-solid fa-bolt interactable" role="button" tabindex="0" aria-label="ST Api Router 便捷方案" title="ST Api Router 便捷方案"></div>')
        : $('<button type="button" class="qr--button quicker-api__quick-entry" aria-label="ST Api Router 便捷方案" title="ST Api Router 便捷方案"><i class="fa-solid fa-bolt"></i><span>ST Api Router</span></button>');
    return entry.attr('id', id)
        .on('click.quickerApi', event => { event.stopPropagation(); openQuickActionMenu(event.currentTarget as HTMLElement, placement); })
        .on('keydown.quickerApi', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openQuickActionMenu(event.currentTarget as HTMLElement, placement); }
        });
}

export function activeQuickReplyButtonContainer(): JQuery<HTMLElement> {
    const candidates = $('#qr--bar > .qr--buttons, #qr--popout > .qr--body > .qr--buttons');
    const visible = candidates.filter(':visible').first();
    return visible.length ? visible : candidates.first();
}

export function ensureQuickActionEntries(): void {
    if (runtimeState.extensionDisabled || runtimeState.teardownPending) return;
    const placement = normalizeQuickActionPlacement(settings().quickActionPlacement);
    if (placement === 'disabled') {
        $('#quicker_api_quick_left, #quicker_api_quick_right, [data-quicker-api-qr-entry]').remove();
        closeQuickActionMenu();
        return;
    }
    if (placement === 'leftSendForm') {
        $('#quicker_api_quick_right, [data-quicker-api-qr-entry]').remove();
        if (!document.getElementById('quicker_api_quick_left')) {
            const extensionsButton = document.getElementById('extensionsMenuButton');
            if (!extensionsButton?.parentElement) return;
            extensionsButton.insertAdjacentElement('afterend', makeQuickActionEntry('quicker_api_quick_left', placement)[0]);
        }
        return;
    }
    if (placement === 'rightSendForm') {
        $('#quicker_api_quick_left, [data-quicker-api-qr-entry]').remove();
        if (!document.getElementById('quicker_api_quick_right')) {
            const sendButton = document.getElementById('send_but');
            const entry = makeQuickActionEntry('quicker_api_quick_right', placement)[0];
            sendButton?.parentElement?.insertBefore(entry, sendButton);
        }
        return;
    }
    $('#quicker_api_quick_left, #quicker_api_quick_right').remove();
    const container = activeQuickReplyButtonContainer();
    if (!container.length) return;
    const current = $('[data-quicker-api-qr-entry]');
    if (current.length && current.parent()[0] === container[0]) return;
    current.remove();
    makeQuickActionEntry('quicker_api_quick_qr', placement).attr('data-quicker-api-qr-entry', 'true').prependTo(container);
}

export function scheduleQuickActionEntries(): void {
    if (runtimeState.quickActionRenderPending || runtimeState.extensionDisabled) return;
    runtimeState.quickActionRenderPending = true;
    queueMicrotask(() => { runtimeState.quickActionRenderPending = false; ensureQuickActionEntries(); });
}
