// 原生预设保存拦截（fetch 包装 + 按钮捕获），用于绑定 preset ↔ Profile

import { saveSettingsDebounced } from '@sillytavern/script';
import { runtimeState, nativePresetCaptureHandlers } from '../state.js';
import { settings, profiles, currentPresetName, selectedProfile } from '../settings/access.js';
import { getEditorModel } from '../native/fields.js';
import { normalizeText } from '../utils/text.js';
import { renderStatus } from '../ui/render.js';

export function bindPresetAfterVerifiedSave(name: unknown, profileId: string): void {
    const presetName = normalizeText(name);
    if (!presetName || !profiles().some(profile => profile.id === profileId)) return;
    settings().presetBindings[presetName] = profileId;
    runtimeState.editorModelBaseline = getEditorModel();
    saveSettingsDebounced();
    renderStatus();
}

export function monitorNativeCreatePopup(intent: Record<string, any>): void {
    let popupSeen = false;
    const startedAt = Date.now();
    const timer = setInterval(() => {
        if (runtimeState.nativePresetSaveIntent !== intent) return clearInterval(timer);
        const popupOpen = Boolean(document.querySelector('dialog.popup[open], .popup[open]'));
        popupSeen ||= popupOpen;
        if ((popupSeen && !popupOpen) || Date.now() - startedAt > 120000) {
            clearInterval(timer);
            setTimeout(() => {
                if (runtimeState.nativePresetSaveIntent === intent) runtimeState.nativePresetSaveIntent = null;
            }, 3000);
        }
    }, 100);
}

export function installPresetSaveObserver(): void {
    if (runtimeState.originalFetch) return;
    const stableFetchDelegate = globalThis.fetch;
    runtimeState.originalFetch = stableFetchDelegate;
    runtimeState.presetObservedFetch = async function quickerApiObservedFetch(this: unknown, resource: RequestInfo | URL, options: RequestInit = {}) {
        const url = typeof resource === 'string' ? resource : (resource instanceof Request ? resource.url : '');
        const intent = runtimeState.nativePresetSaveIntent;
        const observesPresetSave = intent && normalizeText(url).includes('/api/presets/save');
        let body: Record<string, any> | null = null;
        if (observesPresetSave) {
            runtimeState.nativePresetSaveIntent = null;
            try {
                body = JSON.parse(String(options?.body || 'null'));
            } catch {
                body = null;
            }
        }
        const response = await stableFetchDelegate.apply(this, arguments as any);
        if (!observesPresetSave) return response;
        if (!response.ok || body?.apiId !== 'openai') return response;
        try {
            const result = await response.clone().json();
            const savedName = normalizeText(result?.name || body?.name);
            const validUpdate = intent.type === 'update' && savedName === intent.presetName;
            const validCreate = intent.type === 'create' && savedName && !intent.knownPresetNames.has(savedName.toLocaleLowerCase());
            if (validUpdate || validCreate) bindPresetAfterVerifiedSave(savedName, intent.profileId);
        } catch (error) {
            console.warn('[QuickerApi] Could not verify native preset save response:', error);
        }
        return response;
    };
    globalThis.fetch = runtimeState.presetObservedFetch;
}

export function bindNativePresetSaveCapture(): void {
    nativePresetCaptureHandlers.update = () => {
        if (runtimeState.extensionDisabled) return;
        const profile = selectedProfile();
        runtimeState.nativePresetSaveIntent = profile ? {
            type: 'update', profileId: profile.id, presetName: currentPresetName(),
        } : null;
        const intent = runtimeState.nativePresetSaveIntent;
        setTimeout(() => {
            if (runtimeState.nativePresetSaveIntent === intent) runtimeState.nativePresetSaveIntent = null;
        }, 1000);
    };
    nativePresetCaptureHandlers.create = () => {
        if (runtimeState.extensionDisabled) return;
        const profile = selectedProfile();
        runtimeState.nativePresetSaveIntent = profile ? {
            type: 'create',
            profileId: profile.id,
            knownPresetNames: new Set($('#settings_preset_openai option').map((_, option) => normalizeText(option.textContent).toLocaleLowerCase()).get()),
        } : null;
        if (runtimeState.nativePresetSaveIntent) monitorNativeCreatePopup(runtimeState.nativePresetSaveIntent);
    };
    document.getElementById('update_oai_preset')?.addEventListener('click', nativePresetCaptureHandlers.update, true);
    document.getElementById('new_oai_preset')?.addEventListener('click', nativePresetCaptureHandlers.create, true);
}
