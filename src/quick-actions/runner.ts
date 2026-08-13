// 便捷方案执行器（预设 → Profile → 模型 顺序安全切换）

import { oai_settings } from '@sillytavern/scripts/openai';
import { eventSource, event_types, saveSettingsDebounced } from '@sillytavern/script';
import { FORMATS } from '../constants.js';
import { runtimeState } from '../state.js';
import { settings, profiles, selectedProfile, currentPresetName } from '../settings/access.js';
import { normalizeText } from '../utils/text.js';
import { enqueueOperation, waitForStableOperationQueue } from '../operation-queue.js';
import { applyProfile } from '../apply/profile.js';
import { beginPresetTransition, endPresetTransition } from '../presets/transition.js';
import { renderModelControl, renderProfiles } from '../ui/render.js';
import { closeQuickActionMenu } from './menu-core.js';
import { quickActionDisplayName } from '../domain/quick-action.js';
import type { Profile, QuickAction } from '../types.js';

export function findFormatForCurrentSource(): string {
    return Object.entries(FORMATS).find(([, config]) => config.source === oai_settings.chat_completion_source)?.[0] || '';
}

export function applyExplicitModel(model: unknown, preferredFormat = ''): boolean {
    const value = normalizeText(model);
    if (!value) return true;
    const inferredFormat = preferredFormat || findFormatForCurrentSource();
    if (!Object.hasOwn(FORMATS, inferredFormat)) return false;
    const format = inferredFormat;
    const config = FORMATS[format as keyof typeof FORMATS];
    const input = $(config.modelInput);
    if (!input.length) return false;
    if (format === 'openai') {
        oai_settings[config.modelField] = value;
        input.val(value).trigger('input');
    } else {
        if (!input.find('option').filter((_, option) => option.value === value).length) {
            input.append($('<option data-quicker-api-custom="true">').val(value).text(`${value} (Custom)`));
        }
        input.val(value).trigger('change');
        oai_settings[config.modelField] = value;
    }
    return String(input.val() || '') === value && String(oai_settings[config.modelField] || '') === value;
}

export function waitForPresetAfter(expectedName: string, token: number): Promise<boolean> {
    return new Promise(resolve => {
        let settled = false;
        let warningTimer: ReturnType<typeof setTimeout>;
        const finish = (value: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(warningTimer);
            eventSource.removeListener(event_types.OAI_PRESET_CHANGED_AFTER, listener);
            if (runtimeState.quickPresetWaitCancel === cancel) runtimeState.quickPresetWaitCancel = null;
            resolve(value);
        };
        const cancel = () => finish(false);
        const listener = async () => {
            if (token !== runtimeState.quickActionTransaction) return finish(false);
            await runtimeState.operationQueue;
            finish(currentPresetName() === expectedName);
        };
        warningTimer = setTimeout(() => {
            if (!settled && token === runtimeState.quickActionTransaction) {
                toastr.warning('Preset 仍在应用或回滚中；为避免凭据错配，生成保持阻断。后续便捷方案会在本次事务完成后执行。');
            }
        }, 30000);
        runtimeState.quickPresetWaitCancel = cancel;
        eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, listener);
    });
}

export async function selectPresetForQuickAction(name: string, token: number): Promise<boolean> {
    const option = $('#settings_preset_openai option').filter((_, item) => normalizeText(item.textContent) === name).first();
    if (!option.length || token !== runtimeState.quickActionTransaction) return false;
    const after = waitForPresetAfter(name, token);
    $('#settings_preset_openai').val(String(option.val() ?? '')).trigger('change');
    return await after;
}

export async function applyProfileById(profileId: string, token: number = runtimeState.quickActionTransaction, { applyModel = true, manageTransition = true } = {}): Promise<boolean | undefined> {
    const profile = profiles().find(item => item.id === profileId);
    if (!profile || token !== runtimeState.quickActionTransaction) return false;
    const generation = ++runtimeState.profileSelectionGeneration;
    settings().selectedProfileId = profile.id;
    saveSettingsDebounced();
    renderProfiles(profile.id);
    if (manageTransition) beginPresetTransition();
    try {
        return await enqueueOperation(async () => {
            if (token !== runtimeState.quickActionTransaction || generation !== runtimeState.profileSelectionGeneration) return false;
            return await applyProfile(profile, generation, true, applyModel);
        });
    } finally {
        if (manageTransition) endPresetTransition();
    }
}

export async function runQuickAction(action: QuickAction, token: number): Promise<void> {
    if (runtimeState.extensionDisabled || runtimeState.teardownPending || token !== runtimeState.quickActionTransaction) return;
    closeQuickActionMenu();
    beginPresetTransition();
    runtimeState.quickActionBlockingToken = token;
    try {
        if (action.preset && !await selectPresetForQuickAction(action.preset, token)) {
            if (token === runtimeState.quickActionTransaction) toastr.error('便捷方案的 preset 不存在或切换未完成。');
            return;
        }
        if (token !== runtimeState.quickActionTransaction) return;
        let profile: Profile | null = null;
        if (action.profileId) {
            profile = profiles().find(item => item.id === action.profileId) || null;
            const applyModel = !action.preset && !action.model;
            if (!profile || !await applyProfileById(action.profileId, token, { applyModel, manageTransition: false })) {
                if (token === runtimeState.quickActionTransaction) toastr.error('便捷方案的 Profile 未能安全应用。');
                return;
            }
        }
        if (token !== runtimeState.quickActionTransaction) return;
        if (action.model && !applyExplicitModel(action.model, profile?.format || '')) {
            toastr.error('便捷方案模型写入验证失败。');
            return;
        }
        if (token !== runtimeState.quickActionTransaction) return;
        renderProfiles(settings().selectedProfileId);
        if (action.model) renderModelControl(profile || selectedProfile(), action.model);
        toastr.success(`已应用${quickActionDisplayName(action)}。`);
    } finally {
        if (runtimeState.quickActionBlockingToken === token) {
            runtimeState.quickActionBlockingToken = 0;
            endPresetTransition();
        }
    }
}

export function queueQuickAction(action: QuickAction): Promise<unknown> {
    const snapshot = structuredClone(action);
    const run = async () => {
        if (runtimeState.extensionDisabled || runtimeState.teardownPending) return;
        const queueIdle = await waitForStableOperationQueue(30000);
        if (!queueIdle || runtimeState.extensionDisabled || runtimeState.teardownPending) {
            if (!runtimeState.extensionDisabled && !runtimeState.teardownPending) toastr.error('Quicker Api 仍有未完成操作，便捷方案已取消。');
            return;
        }
        const token = ++runtimeState.quickActionTransaction;
        runtimeState.profileSelectionGeneration++;
        return await runQuickAction(snapshot, token);
    };
    runtimeState.quickActionQueue = runtimeState.quickActionQueue.then(run, run);
    return runtimeState.quickActionQueue;
}
