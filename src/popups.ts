// Popup 封装（宿主 Popup 生命周期管理）

import { Popup, POPUP_TYPE } from '@sillytavern/scripts/popup';
import { runtimeState, ownedPopups } from './state.js';
import { sanitizeName } from './utils/text.js';

export async function callQuickerPopup(content: JQuery<HTMLElement> | string, type: string, inputValue = '', popupOptions: Record<string, any> = {}): Promise<any> {
    if (runtimeState.extensionDisabled || runtimeState.teardownPending) return type === POPUP_TYPE.INPUT ? null : false;
    const popup = new Popup(content, type, inputValue, popupOptions);
    ownedPopups.add(popup);
    try {
        return await popup.show();
    } finally {
        ownedPopups.delete(popup);
    }
}

export async function cancelOwnedPopups(): Promise<void> {
    const popups = [...ownedPopups];
    await Promise.allSettled(popups.map(popup => popup.completeCancelled()));
}

export async function promptName(message: string, initialValue = ''): Promise<string | null> {
    const result = await callQuickerPopup(message, POPUP_TYPE.INPUT, initialValue);
    if (result === null || result === false || result === undefined) return null;
    return sanitizeName(result) || null;
}
