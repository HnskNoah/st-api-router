// Vendor/Group 路由钩子：生成前按当前 Group 的逻辑模型选路并写回 ST；
// 结束后按失败观察结果记录 Vendor 成功/失败，连续失败自动禁用整个 Vendor。

import { saveSettingsDebounced } from '@sillytavern/script';
import { oai_settings } from '@sillytavern/scripts/openai';
import { Popup } from '@sillytavern/scripts/popup';
import { routeGroupOnce, type GroupRouteUnit } from '../domain/group-routing.js';
import { computeVendorTokenClamps, recordVendorFailure, recordVendorSuccess } from '../domain/vendor.js';
import { applyVendorConnection, applyVendorTokenClamps, snapshotConnection, restoreConnection } from './apply-provider.js';
import { runtimeState } from '../state.js';
import { enqueueConnectionMutation } from '../operation-queue.js';
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
    onGenerationStarted(): void;
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

    async function onGenerationStarted(): Promise<void> {
        debugLog('onGenerationStarted enter', {
            routingEnabled: deps.getRouting().enabled,
            activeGroupId: deps.getActiveGroupId(),
            groupCount: deps.getGroups().length,
        });
        if (runtimeState.generationRoutingInFlight) {
            debugLog('onGenerationStarted skip: another routing in flight');
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
        // 连接写入放入互斥队列：避免和 preset 联动/Profile 应用并发改写 ST 连接字段
        await enqueueConnectionMutation(async () => {
            const snapshot = snapshotConnection();
            try {
                // 路由前确认 token 限制：Vendor 设置了上下文/输入/输出上限且需要调整时，弹窗确认后再钳制
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
                applyVendorConnection(unit.vendor, unit.entry.apiKey, unit.realModel);
            } catch (error) {
                console.error('[QuickerApi] Vendor connection apply failed:', error);
                debugLog('onGenerationStarted connection apply failed', error);
                restoreConnection(snapshot);
                toastr.error('Quicker Api：Vendor 连接应用失败，已恢复原连接。');
                return;
            }
            state.active = { unit, logicalModelId };
            deps.beginGeneration?.();
            debugLog('onGenerationStarted done');
        });
    }

    function onGenerationStopped(): void {
        debugLog('onGenerationStopped', { hadActive: Boolean(state.active) });
        state.userStopPending = true;
        state.active = null;
        deps.endGeneration?.(); // 关闭失败观察窗口（丢弃结果）
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
        // 用户停止：ENDED 先于 STOPPED 触发，稍等再判定
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
                toastr.error(`Quicker Api：Vendor「${vendor.name}」连续失败已自动禁用，请手动重新启用。`);
            } else {
                toastr.warning(`Quicker Api：Vendor「${vendor.name}」本次生成失败已记录；连续失败将自动禁用。`);
            }
        }, USER_STOP_GRACE_MS);
    }

    return {
        onGenerationStarted,
        onGenerationStopped,
        onGenerationEnded,
        getActiveUnit: () => state.active?.unit ?? null,
    };
}
