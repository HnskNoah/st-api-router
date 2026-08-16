// Vendor/Group 路由钩子：生成前按当前 Group 的逻辑模型选路；
// 生成数据就绪后直接改 generateData（拦截模式，不碰 ST 原生 DOM/连接字段）；
// 结束后按失败观察结果记录 Vendor 成功/失败，连续失败自动禁用整个 Vendor。

import { saveSettingsDebounced, setOnlineStatus } from '@sillytavern/script';
import { oai_settings } from '@sillytavern/scripts/openai';
import { Popup } from '@sillytavern/scripts/popup';
import { routeGroupOnce, type GroupRouteUnit } from '../domain/group-routing.js';
import { computeVendorTokenClamps, recordVendorFailure, recordVendorSuccess } from '../domain/vendor.js';
import { applyVendorTokenClamps } from './apply-provider.js';
import { patchGenerateData } from './patch-generate-data.js';
import { runtimeState } from '../state.js';
import { debugLog } from '../debug.js';
import type { Group, RoutingSettings, Vendor } from '../types.js';

const USER_STOP_GRACE_MS = 50;

export interface RoutingHooksDeps {
    getVendors(): Vendor[];
    getGroups(): Group[];
    getActiveGroupId(): string | null;
    getRouting(): RoutingSettings;
    beginGeneration?(): void;
    endGeneration?(): boolean;
}

export interface RoutingHooks {
    onGenerationStarted(type?: string, automaticTrigger?: unknown): void;
    onChatCompletionSettingsReady(generateData: Record<string, any>): void;
    onGenerationStopped(): void;
    onGenerationEnded(): void;
    getActiveUnit(): GroupRouteUnit | null;
}

export function createRoutingHooks(deps: RoutingHooksDeps): RoutingHooks {
    const state: {
        active: { unit: GroupRouteUnit; logicalModelId: string } | null;
        userStopPending: boolean;
    } = {
        active: null,
        userStopPending: false,
    };

    async function onGenerationStarted(type?: string, automaticTrigger?: unknown): Promise<void> {
        debugLog('onGenerationStarted enter', {
            type,
            automaticTrigger: Boolean(automaticTrigger),
            routingEnabled: deps.getRouting().enabled,
            activeGroupId: deps.getActiveGroupId(),
            groupCount: deps.getGroups().length,
        });
        // 跳过非用户主动触发的生成：quiet/continue/impersonate
        if (type === 'quiet' || type === 'continue' || type === 'impersonate') {
            debugLog('onGenerationStarted skip: non-user trigger', { type });
            return;
        }
        if (runtimeState.generationRoutingInFlight) {
            debugLog('onGenerationStarted skip: another routing in flight');
            toastr.info('Quicker Api：上一轮路由尚未完成，本次生成已跳过。', '', { timeOut: 3000 });
            return;
        }
        runtimeState.generationRoutingInFlight = true;
        try {
            await runGenerationRouting();
        } finally {
            runtimeState.generationRoutingInFlight = false;
        }
    }

    async function runGenerationRouting(): Promise<void> {
        const routing = deps.getRouting();
        if (!routing.enabled) {
            debugLog('onGenerationStarted skip: routing disabled');
            return;
        }
        const groups = deps.getGroups();
        const activeGroup = groups.find(group => group.id === deps.getActiveGroupId()) || groups[0] || null;
        if (!activeGroup || !activeGroup.enabled) {
            debugLog('onGenerationStarted skip: no active/enabled group', activeGroup?.id ?? null);
            return;
        }
        const logicalModelId = activeGroup.currentLogicalModelId;
        if (!logicalModelId) {
            toastr.warning('Quicker Api：当前 Group 尚未选择逻辑模型。');
            debugLog('onGenerationStarted skip: no logical model', { activeGroupId: activeGroup.id });
            return;
        }
        const result = routeGroupOnce(deps.getVendors(), activeGroup, logicalModelId);
        if (!result.unit) {
            toastr.warning(`Quicker Api：逻辑模型当前无可用 Vendor（${result.reasons.join('；') || '无候选'}）。`);
            debugLog('onGenerationStarted skip: no route unit', { logicalModelId, reasons: result.reasons });
            return;
        }
        const unit = result.unit;
        debugLog('onGenerationStarted routed', {
            vendorId: unit.vendor.id,
            vendorName: unit.vendor.name,
            entryId: unit.entry.id,
            entryLabel: unit.entry.label,
            realModel: unit.realModel,
            rpmWindowCount: unit.vendor.window?.length ?? 0,
        });

        // token 限制确认并钳制（只改 oai_settings，不触发 reconnect）
        const clamps = computeVendorTokenClamps(unit.vendor, {
            maxContext: Number(oai_settings.openai_max_context) || 0,
            maxOutputTokens: Number(oai_settings.openai_max_tokens) || 0,
        });
        const needsApply = clamps.maxContext !== undefined || clamps.maxOutputTokens !== undefined;
        debugLog('onGenerationStarted token clamps', { needsApply, clamps });
        if (needsApply) {
            const details: string[] = [];
            if (clamps.maxContext !== undefined) details.push(`总上下文 → ${clamps.maxContext}`);
            if (clamps.maxOutputTokens !== undefined) details.push(`输出 token → ${clamps.maxOutputTokens}`);
            debugLog('onGenerationStarted showing token confirm');
            const confirmed = await Popup.show.confirm(
                '调整 token 限制',
                `路由到 Vendor「${unit.vendor.name}」会按它的限制钳制 SillyTavern token 设置：\n${details.join('\n')}\n\n确定应用？`,
            );
            debugLog('onGenerationStarted token confirm result', { confirmed });
            if (confirmed) applyVendorTokenClamps(unit.vendor);
        }

        // 存储选中的 unit，等 CHAT_COMPLETION_SETTINGS_READY 时直接改 generateData
        state.active = { unit, logicalModelId };
        deps.beginGeneration?.();
        setOnlineStatus('Valid');
        toastr.info(`Quicker Api：${unit.vendor.name} / ${unit.entry.label} / ${unit.realModel}`, '已路由', { timeOut: 8000 });
        debugLog('onGenerationStarted done');
    }

    function onChatCompletionSettingsReady(generateData: Record<string, any>): void {
        const active = state.active;
        if (!active) return;
        debugLog('onChatCompletionSettingsReady patch', {
            vendorName: active.unit.vendor.name,
            entryLabel: active.unit.entry.label,
            realModel: active.unit.realModel,
        });
        patchGenerateData(generateData, active.unit);
    }

    function onGenerationStopped(): void {
        debugLog('onGenerationStopped', { hadActive: Boolean(state.active) });
        state.userStopPending = true;
        state.active = null;
        deps.endGeneration?.();
    }

    function onGenerationEnded(): void {
        debugLog('onGenerationEnded enter', { hadActive: Boolean(state.active), userStopPending: state.userStopPending });
        const active = state.active;
        if (!active) {
            debugLog('onGenerationEnded skip: no active route');
            return;
        }
        state.active = null;
        const failed = deps.endGeneration?.() ?? false;
        const { vendor, entry, realModel } = active.unit;
        const displayName = `${vendor.name} / ${entry.label} / ${realModel}`;
        debugLog('onGenerationEnded active route', { displayName, failed });
        setTimeout(() => {
            if (state.userStopPending) {
                state.userStopPending = false;
                debugLog('onGenerationEnded user stop, ignored');
                return;
            }
            const routing = deps.getRouting();
            if (!failed) {
                recordVendorSuccess(vendor);
                saveSettingsDebounced();
                debugLog('onGenerationEnded recorded success', { vendorName: vendor.name });
                return;
            }
            const disabled = recordVendorFailure(vendor, `generation failed: ${realModel}`, routing.failThreshold);
            saveSettingsDebounced();
            debugLog('onGenerationEnded recorded failure', { vendorName: vendor.name, disabled });
            if (disabled) {
                toastr.error(`Quicker Api：${displayName} 连续失败已自动禁用，请手动重新启用。`);
            } else {
                toastr.warning(`Quicker Api：${displayName} 本次生成失败已记录；连续失败将自动禁用。`);
            }
        }, USER_STOP_GRACE_MS);
    }

    return {
        onGenerationStarted,
        onChatCompletionSettingsReady,
        onGenerationStopped,
        onGenerationEnded,
        getActiveUnit: () => state.active?.unit ?? null,
    };
}