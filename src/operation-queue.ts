// 操作队列（串行化所有敏感的连接/密钥操作）

import { runtimeState } from './state.js';
import { debugLog } from './debug.js';

const CONTROLS_SELECTOR = '#quicker_api select, #quicker_api button';

function setControlsDisabled(disabled: boolean): void {
    $(CONTROLS_SELECTOR).prop('disabled', disabled);
}

export function enqueueOperation<T>(operation: () => Promise<T> | T): Promise<T | undefined> {
    const run = async () => {
        debugLog('operation start', {
            extensionDisabled: runtimeState.extensionDisabled,
            teardownPending: runtimeState.teardownPending,
        });
        if (runtimeState.extensionDisabled || runtimeState.teardownPending) return undefined;
        const presetWasDisabled = Boolean($('#settings_preset_openai').prop('disabled'));
        setControlsDisabled(true);
        $('#settings_preset_openai').prop('disabled', true);
        try {
            const result = await operation();
            debugLog('operation done');
            return result;
        } catch (error) {
            console.error('[QuickerApi] Operation failed:', error);
            debugLog('operation failed', error);
            toastr.error('Quicker Api 操作失败；未确认的连接不会被启用。');
            return undefined;
        } finally {
            if (!runtimeState.extensionDisabled) setControlsDisabled(false);
            debugLog('operation finally', { presetWasDisabled });
        }
    };
    runtimeState.operationQueue = runtimeState.operationQueue.then(run, run);
    return runtimeState.operationQueue as Promise<T | undefined>;
}

/** 串行化所有直接改写 ST 连接字段的操作（路由写入、Profile 应用、便捷方案切换）。 */
export function enqueueConnectionMutation<T>(operation: () => Promise<T> | T): Promise<T | undefined> {
    const run = async () => {
        if (runtimeState.extensionDisabled || runtimeState.teardownPending) return undefined;
        try {
            return await operation();
        } catch (error) {
            console.error('[QuickerApi] Connection mutation failed:', error);
            debugLog('connection mutation failed', error);
            return undefined;
        }
    };
    runtimeState.connectionMutationQueue = runtimeState.connectionMutationQueue.then(run, run);
    return runtimeState.connectionMutationQueue as Promise<T | undefined>;
}

export async function waitForStableOperationQueue(timeout = 30000): Promise<boolean> {
    const deadline = Date.now() + timeout;
    while (!runtimeState.extensionDisabled && !runtimeState.teardownPending) {
        const snapshot = runtimeState.operationQueue;
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const settled = await Promise.race([
            snapshot.then(() => true, () => true),
            new Promise<boolean>(resolve => {
                timeoutId = setTimeout(() => resolve(false), remaining);
            }),
        ]).finally(() => {
            if (timeoutId) clearTimeout(timeoutId);
        });
        if (!settled || runtimeState.extensionDisabled || runtimeState.teardownPending) return false;
        await new Promise(resolve => setTimeout(resolve, 0));
        if (runtimeState.operationQueue === snapshot) return true;
    }
    return false;
}
