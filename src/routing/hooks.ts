// Vendor/Group 路由钩子：生成前按当前 Group 的逻辑模型选路并写回 ST；
// 结束后按失败观察结果记录 Vendor 成功/失败，连续失败自动禁用整个 Vendor。

import { saveSettingsDebounced } from '@sillytavern/script';
import { oai_settings } from '@sillytavern/scripts/openai';
import { Popup } from '@sillytavern/scripts/popup';
import { routeGroupOnce, type GroupRouteUnit } from '../domain/group-routing.js';
import { computeVendorTokenClamps, recordVendorFailure, recordVendorSuccess } from '../domain/vendor.js';
import { applyVendorConnection, applyVendorTokenClamps, snapshotConnection, restoreConnection } from './apply-provider.js';
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
        const routing = deps.getRouting();
        if (!routing.enabled) return;
        const groups = deps.getGroups();
        const activeGroup = groups.find(group => group.id === deps.getActiveGroupId()) || groups[0] || null;
        if (!activeGroup || !activeGroup.enabled) return;
        const logicalModelId = activeGroup.currentLogicalModelId;
        if (!logicalModelId) {
            toastr.warning('Quicker Api：当前 Group 尚未选择逻辑模型。');
            return;
        }
        const result = routeGroupOnce(deps.getVendors(), activeGroup, logicalModelId);
        if (!result.unit) {
            toastr.warning(`Quicker Api：逻辑模型当前无可用 Vendor（${result.reasons.join('；') || '无候选'}）。`);
            return;
        }
        const snapshot = snapshotConnection();
        try {
            // 路由前确认 token 限制：Vendor 设置了上下文/输入/输出上限且需要调整时，弹窗确认后再钳制
            const clamps = computeVendorTokenClamps(result.unit.vendor, {
                maxContext: Number(oai_settings.openai_max_context) || 0,
                maxOutputTokens: Number(oai_settings.openai_max_tokens) || 0,
            });
            const needsApply = clamps.maxContext !== undefined || clamps.maxOutputTokens !== undefined;
            if (needsApply) {
                const details: string[] = [];
                if (clamps.maxContext !== undefined) details.push(`总上下文 → ${clamps.maxContext}`);
                if (clamps.maxOutputTokens !== undefined) details.push(`输出 token → ${clamps.maxOutputTokens}`);
                const confirmed = await Popup.show.confirm(
                    '调整 token 限制',
                    `路由到 Vendor「${result.unit.vendor.name}」会按它的限制钳制 SillyTavern token 设置：\n${details.join('\n')}\n\n确定应用？`,
                );
                if (confirmed) applyVendorTokenClamps(result.unit.vendor);
            }
            applyVendorConnection(result.unit.vendor, result.unit.entry.apiKey, result.unit.realModel);
        } catch (error) {
            console.error('[QuickerApi] Vendor connection apply failed:', error);
            restoreConnection(snapshot);
            toastr.error('Quicker Api：Vendor 连接应用失败，已恢复原连接。');
            return;
        }
        state.active = { unit: result.unit, logicalModelId };
        deps.beginGeneration?.();
    }

    function onGenerationStopped(): void {
        state.userStopPending = true;
        state.active = null;
        deps.endGeneration?.(); // 关闭失败观察窗口（丢弃结果）
    }

    function onGenerationEnded(): void {
        const active = state.active;
        if (!active) return;
        state.active = null;
        const failed = deps.endGeneration?.() ?? false;
        const { vendor, entry, realModel } = active.unit;
        const displayName = `${vendor.name} / ${entry.label} / ${realModel}`;
        // 用户停止：ENDED 先于 STOPPED 触发，稍等再判定
        setTimeout(() => {
            if (state.userStopPending) {
                state.userStopPending = false;
                return;
            }
            const routing = deps.getRouting();
            if (!failed) {
                recordVendorSuccess(vendor);
                saveSettingsDebounced();
                return;
            }
            const disabled = recordVendorFailure(vendor, `generation failed: ${realModel}`, routing.failThreshold);
            saveSettingsDebounced();
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
