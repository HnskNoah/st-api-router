// 运行时可变状态单例（来自 index.js 顶部的 let/const 状态）。
// 跨模块共享同一实例，避免 import 环；teardown 时统一复位。

export const runtimeState = {
    operationQueue: Promise.resolve() as Promise<unknown>,
    connectionMutationQueue: Promise.resolve() as Promise<unknown>,
    profileSelectionGeneration: 0,
    extensionDisabled: false,
    teardownPending: false,
    presetEventDedupe: null as { name: string; at: number } | null,
    presetTransitionBlocked: false,
    presetConnectWasDisabled: false,
    nativePresetSaveIntent: null as Record<string, any> | null,
    originalFetch: null as (typeof globalThis.fetch) | null,
    presetObservedFetch: null as (typeof globalThis.fetch) | null,
    editorModelBaseline: '',
    quickActionQueue: Promise.resolve() as Promise<unknown>,
    quickActionTransaction: 0,
    quickActionBlockingToken: 0,
    quickPresetWaitCancel: null as (() => void) | null,
    quickActionMenu: null as JQuery<HTMLElement> | null,
    quickActionPopper: null as { destroy?: () => void } | null,
    quickActionPlacementPopup: null as { completeCancelled: () => Promise<void> } | null,
    quickActionObserver: null as MutationObserver | null,
    quickActionRenderPending: false,
    generationRoutingInFlight: false,
};

export const nativePresetCaptureHandlers: Record<string, (() => void) | undefined> = {};
export const ownedPopups = new Set<{ completeCancelled: () => Promise<void> }>();
export const activeFetchControllers = new Set<AbortController>();

/** 预设切换/QA 方案执行期间阻断连接按钮，防止凭据错配。 */
export function beginPresetTransition(): void {
    if (!runtimeState.presetTransitionBlocked) runtimeState.presetConnectWasDisabled = Boolean($('#api_button_openai').prop('disabled'));
    runtimeState.presetTransitionBlocked = true;
    $('#api_button_openai').prop('disabled', true);
}

export function endPresetTransition({ force = false }: { force?: boolean } = {}): void {
    if (runtimeState.teardownPending && !force) return;
    if (!runtimeState.presetTransitionBlocked) return;
    runtimeState.presetTransitionBlocked = false;
    $('#api_button_openai').prop('disabled', runtimeState.presetConnectWasDisabled);
}
