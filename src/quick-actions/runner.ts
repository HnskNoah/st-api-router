// 便捷方案执行器（预设 → 逻辑模型 顺序安全切换）

import { oai_settings } from '@sillytavern/scripts/openai';
import { eventSource, event_types, saveSettingsDebounced } from '@sillytavern/script';
import { FORMATS } from '../constants.js';
import { runtimeState, beginPresetTransition, endPresetTransition } from '../state.js';
import { settings, groups, logicalModels, routingSettings, currentPresetName } from '../settings/access.js';
import { normalizeText } from '../utils/text.js';
import { isRoutedModel } from '../domain/vendor.js';
import { resolveLogicalModelForAction } from '../domain/quick-action.js';
import { enqueueOperation, waitForStableOperationQueue } from '../operation-queue.js';
import { closeQuickActionMenu } from './menu-core.js';
import { quickActionDisplayName } from '../domain/quick-action.js';
import { debugLog } from '../debug.js';
import type { LogicalModel, QuickAction } from '../types.js';

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

/** 真实模型在当前分组 entries 中归属的逻辑模型；仅当归属唯一时返回，否则 null。 */
function routedRealModelOwnerInActiveGroup(model: string): LogicalModel | null {
    const activeGroup = groups().find(group => group.id === settings().activeGroupId) || groups()[0] || null;
    if (!activeGroup) return null;
    const ownerIds = new Set<string>();
    for (const entry of activeGroup.entries ?? []) {
        for (const mapping of entry.mappings ?? []) {
            if (mapping.realModel === model && mapping.logicalModelId) ownerIds.add(mapping.logicalModelId);
        }
    }
    if (ownerIds.size !== 1) return null;
    return logicalModels().find(item => item.id === [...ownerIds][0]) ?? null;
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

export function selectPresetForQuickAction(name: string, token: number): Promise<boolean> {
    const option = $('#settings_preset_openai option').filter((_, item) => normalizeText(item.textContent) === name).first();
    if (!option.length || token !== runtimeState.quickActionTransaction) return Promise.resolve(false);
    const after = waitForPresetAfter(name, token);
    $('#settings_preset_openai').val(String(option.val() ?? '')).trigger('change');
    return after;
}

export async function runQuickAction(action: QuickAction, token: number): Promise<void> {
    debugLog('runQuickAction', { actionId: action.id, actionName: action.name, preset: action.preset, model: action.model, token });
    if (runtimeState.extensionDisabled || runtimeState.teardownPending || token !== runtimeState.quickActionTransaction) {
        debugLog('runQuickAction skip', { extensionDisabled: runtimeState.extensionDisabled, teardownPending: runtimeState.teardownPending, tokenMatch: token === runtimeState.quickActionTransaction });
        return;
    }
    closeQuickActionMenu();
    beginPresetTransition();
    runtimeState.quickActionBlockingToken = token;
    try {
        if (action.preset && !await selectPresetForQuickAction(action.preset, token)) {
            if (token === runtimeState.quickActionTransaction) toastr.error('便捷方案的 preset 不存在或切换未完成。');
            debugLog('runQuickAction failed: preset switch', { preset: action.preset });
            return;
        }
        if (token !== runtimeState.quickActionTransaction) {
            debugLog('runQuickAction abort: stale token after preset', { token });
            return;
        }
        let switchedLogicalModel: LogicalModel | null = null;
        if (action.model) {
            const activeGroup = groups().find(group => group.id === settings().activeGroupId) || groups()[0] || null;
            // 逻辑模型：直接切换当前 Group 的逻辑模型（下次生成由路由钩子选 Vendor/Key）
            const logical = resolveLogicalModelForAction(action.model, logicalModels());
            // 路由命中的真实模型：拦截模式下 generateData.model 由选路结果覆盖，写 custom_model 不生效；
            // 改为切换到该真实模型在当前分组唯一归属的逻辑模型
            const routed = !logical && routingSettings().enabled && isRoutedModel(groups(), logicalModels(), action.model);
            const target = logical ?? (routed ? routedRealModelOwnerInActiveGroup(String(action.model)) : null);
            if (target) {
                const activeGroup = groups().find(group => group.id === settings().activeGroupId) || groups()[0] || null;
                if (!activeGroup) {
                    toastr.warning('Quicker Api：还没有 Group，无法切换逻辑模型。');
                    debugLog('runQuickAction failed: no group for logical model', { logicalModel: action.model });
                    return;
                }
                activeGroup.currentLogicalModelId = target.id;
                switchedLogicalModel = target;
                debugLog('runQuickAction switched logical model', {
                    logicalModelId: target.id,
                    logicalModelName: target.name,
                    viaRealModel: logical ? undefined : action.model,
                });
            } else if (routed) {
                // 真实模型存在但归属不唯一（或当前分组无承载映射）：如实告知，保持现状
                toastr.warning(`Quicker Api：真实模型「${action.model}」在当前分组没有唯一归属的逻辑模型，已保持当前路由不变。`);
                debugLog('runQuickAction skipped ambiguous routed model', { model: action.model });
                return;
            } else {
                // 其余走原生格式推断
                const applied = applyExplicitModel(action.model);
                if (!applied) {
                    toastr.error('便捷方案模型写入验证失败。');
                    debugLog('runQuickAction failed: model write', { model: action.model });
                    return;
                }
                debugLog('runQuickAction applied explicit model', { model: action.model });
            }
        }
        if (token !== runtimeState.quickActionTransaction) {
            debugLog('runQuickAction abort: stale token after model', { token });
            return;
        }
        if (switchedLogicalModel) {
            saveSettingsDebounced();
            $(document).trigger('quickerApi:logical-model-changed');
            toastr.success(`已切换到逻辑模型「${switchedLogicalModel.name}」。`);
        } else {
            toastr.success(`已应用${quickActionDisplayName(action)}。`);
        }
        debugLog('runQuickAction done', { actionId: action.id });
    } finally {
        if (runtimeState.quickActionBlockingToken === token) {
            runtimeState.quickActionBlockingToken = 0;
            endPresetTransition();
        }
        debugLog('runQuickAction finally', { token });
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
        return await runQuickAction(snapshot, token);
    };
    runtimeState.quickActionQueue = runtimeState.quickActionQueue.then(run, run);
    return runtimeState.quickActionQueue;
}