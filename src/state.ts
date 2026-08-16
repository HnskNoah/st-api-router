// 运行时可变状态单例（来自 index.js 顶部的 let/const 状态）。
// 跨模块共享同一实例，避免 import 环；teardown 时统一复位。

export const runtimeState = {
    operationQueue: Promise.resolve() as Promise<unknown>,
    connectionMutationQueue: Promise.resolve() as Promise<unknown>,
    profileSelectionGeneration: 0,
    extensionDisabled: false,
    teardownPending: false,
    presetChangeTimer: null as ReturnType<typeof setTimeout> | null,
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

export function resetRuntimeState() {
    runtimeState.operationQueue = Promise.resolve();
    runtimeState.connectionMutationQueue = Promise.resolve();
    runtimeState.profileSelectionGeneration = 0;
    runtimeState.extensionDisabled = false;
    runtimeState.teardownPending = false;
    runtimeState.presetChangeTimer = null;
    runtimeState.presetEventDedupe = null;
    runtimeState.presetTransitionBlocked = false;
    runtimeState.presetConnectWasDisabled = false;
    runtimeState.nativePresetSaveIntent = null;
    runtimeState.originalFetch = null;
    runtimeState.presetObservedFetch = null;
    runtimeState.editorModelBaseline = '';
    runtimeState.quickActionQueue = Promise.resolve();
    runtimeState.quickActionTransaction = 0;
    runtimeState.quickActionBlockingToken = 0;
    runtimeState.quickPresetWaitCancel = null;
    runtimeState.quickActionMenu = null;
    runtimeState.quickActionPopper = null;
    runtimeState.quickActionPlacementPopup = null;
    runtimeState.quickActionObserver = null;
    runtimeState.quickActionRenderPending = false;
    runtimeState.generationRoutingInFlight = false;
    for (const key of Object.keys(nativePresetCaptureHandlers)) delete nativePresetCaptureHandlers[key];
    ownedPopups.clear();
    activeFetchControllers.clear();
}
