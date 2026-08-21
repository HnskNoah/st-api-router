// Vendor/Group 路由钩子：生成前按当前 Group 的逻辑模型选路；
// 生成数据就绪后直接改 generateData（拦截模式，不碰 ST 原生 DOM/连接字段）；
// 结束后按失败观察结果记录 Key × realModel 成功/失败（模型级熔断），不再自动禁用整个 Vendor。

import { saveSettingsDebounced, setOnlineStatus } from '@sillytavern/script';
import { oai_settings } from '@sillytavern/scripts/openai';
import { SECRET_KEYS } from '@sillytavern/scripts/secrets';
import { Popup } from '@sillytavern/scripts/popup';
import { ensureSecretId } from '../secrets/api.js';
import { routeGroupOnce, recordGroupSelection, type GroupRouteSticky, type GroupRouteUnit } from '../domain/group-routing.js';
import { recordModelFailure, recordModelObservation, recordModelSuccess } from '../domain/model-health.js';
import { computeVendorTokenClamps, recordVendorSuccess } from '../domain/vendor.js';
import { applyVendorTokenClamps } from './apply-provider.js';
import { patchGenerateData } from './patch-generate-data.js';
import { resolveFallbackRoute } from './fallback.js';
import { isManualLockApplicable } from './manual-route.js';
import { isGenerationBlockedByGuard } from '../domain/generation-guard.js';
import { runtimeState } from '../state.js';
import { debugLog } from '../debug.js';
import type { FailureProbe } from './failure-observer.js';
import type { Group, LogicalModel, ModelObservationRecord, RoutingSettings, Vendor } from '../types.js';

const USER_STOP_GRACE_MS = 50;

export interface RoutingHooksDeps {
    getVendors(): Vendor[];
    getGroups(): Group[];
    getLogicalModels(): LogicalModel[];
    getActiveGroupId(): string | null;
    getRouting(): RoutingSettings;
    /** 将错误或空回复追加到全局有界历史。 */
    recordObservation?(record: ModelObservationRecord): void;
    beginGeneration?(): void;
    /** 返回本次生成的错误或结果观测；null 表示没有异常观测。 */
    endGeneration?(): FailureProbe | null;

}
export interface RoutingHooks {
    onGenerationStarted(type?: string, automaticTrigger?: unknown): void;
    onChatCompletionSettingsReady(generateData: Record<string, any>): void;
    onGenerationStopped(): void;
    onGenerationEnded(): void;
    getActiveUnit(): GroupRouteUnit | null;
    lockManualRoute(unit: GroupRouteUnit): void;
}

export function createRoutingHooks(deps: RoutingHooksDeps): RoutingHooks {
    const state: {
        active: { unit: GroupRouteUnit; logicalModelId: string; groupId: string } | null;
        userStopPending: boolean;
        manualLockedUnit: GroupRouteUnit | null;
        lastPicked: GroupRouteSticky | null;
    } = {
        active: null,
        userStopPending: false,
        manualLockedUnit: null,
        lastPicked: null,
    };

    function customParamsForUnit(unit: GroupRouteUnit): { includeBody: string; excludeBody: string; includeHeaders: string } {
        const logical = deps.getLogicalModels().find(item => item.id === unit.mapping?.logicalModelId);
        return {
            includeBody: logical?.customIncludeBody ?? '',
            excludeBody: logical?.customExcludeBody ?? '',
            includeHeaders: logical?.customIncludeHeaders ?? '',
        };
    }

    /** custom Vendor 的 Key 若还没有 secretId，则在生成前按值找/写一条并缓存，避免 custom 源读不到 key。 */
    async function ensureEntrySecret(unit: GroupRouteUnit): Promise<void> {
        if (unit.vendor?.format !== 'custom' || !unit.entry?.apiKey || unit.entry.secretId) return;
        const id = await ensureSecretId(SECRET_KEYS.CUSTOM, unit.entry.apiKey, `quicker-api:${unit.vendor.name}`);
        if (!id) return;
        unit.entry.secretId = id;
        saveSettingsDebounced();
        debugLog('ensureEntrySecret cached', {
            vendorName: unit.vendor.name,
            entryLabel: unit.entry.label,
            secretId: id,
        });
    }

    async function onGenerationStarted(type?: string, automaticTrigger?: unknown): Promise<void> {
        // 新一轮生成开始：清掉上一轮 STOPPED 留下的 pending 标记
        // （否则一次用户停止会让后续所有生成的成败都跳过记录）
        state.userStopPending = false;
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
        let unit: GroupRouteUnit | null = consumeManualLock(activeGroup, logicalModelId);
        if (!unit) {
            const result = routeGroupOnce(deps.getVendors(), activeGroup, logicalModelId, {
                stickyCount: routing.stickyCount,
                lastPicked: state.lastPicked,
            });
            state.lastPicked = result.nextLastPicked;
            if (!result.unit) {
                toastr.warning(`Quicker Api：逻辑模型当前无可用 Vendor（${result.reasons.join('；') || '无候选'}）。`);
                debugLog('onGenerationStarted skip: no route unit', { logicalModelId, reasons: result.reasons });
                return;
            }
            unit = result.unit;
        }
        debugLog('onGenerationStarted routed', {
            vendorId: unit.vendor.id,
            vendorName: unit.vendor.name,
            entryId: unit.entry.id,
            entryLabel: unit.entry.label,
            realModel: unit.realModel,
            rpmWindowCount: unit.vendor.window?.length ?? 0,
        });

        await ensureEntrySecret(unit);

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
        state.active = { unit, logicalModelId, groupId: activeGroup.id };
        debugLog('onGenerationStarted active set', {
            vendorName: unit.vendor.name,
            entryLabel: unit.entry.label,
            realModel: unit.realModel,
            presetTransitionBlocked: runtimeState.presetTransitionBlocked,
        });
        deps.beginGeneration?.();
        setOnlineStatus('Valid');
        debugLog('onGenerationStarted done');
    }

    async function onChatCompletionSettingsReady(generateData: Record<string, any>): Promise<void> {
        // guard 已阻断本次生成（预设切换中 / 密钥安全阻断）时不覆盖，避免拦截模式绕过安全阻断
        if (isGenerationBlockedByGuard(generateData?.chat_completion_source)) {
            debugLog('onChatCompletionSettingsReady skip: generation blocked by guard', {
                source: generateData?.chat_completion_source,
            });
            return;
        }
        const active = state.active;
        if (active) {
            patchGenerateData(generateData, active.unit, customParamsForUnit(active.unit));
            // 不写 oai_settings / 不触发连接（拦截模式，保持用户空占位连接状态仅 setOnlineStatus）
            const source = generateData.chat_completion_source;
            const endpoint = source === 'custom' ? generateData.custom_url : generateData.reverse_proxy;
            const u = active.unit;
            toastr.info(`Quicker Api：${u.vendor.name} / ${u.realModel}${source !== 'custom' ? '' : ' · 自定义源'}`, '已路由', { timeOut: 8000 });
            debugLog('onChatCompletionSettingsReady patch', {
                vendorName: u.vendor.name,
                entryLabel: u.entry.label,
                realModel: u.realModel,
                source,
                endpoint,
                model: generateData.model,
                hasKey: Boolean(generateData.secret_id ?? generateData.proxy_password),
                stConnectionSynced: true,
            });
            return;
        }
        debugLog('onChatCompletionSettingsReady no active route', {
            source: generateData?.chat_completion_source,
            presetTransitionBlocked: runtimeState.presetTransitionBlocked,
            manualLocked: Boolean(state.manualLockedUnit),
        });
        await routeFallbackIfNeeded(generateData);
    }

    /**
     * 兜底路由：JS-Slash-Runner 等插件走独立请求流，只发 CHAT_COMPLETION_SETTINGS_READY、
     * 不发 GENERATION_STARTED，state.active 为空。此时按当前 Group 逻辑模型接管连接字段，
     * 避免独立流用原生（可能过期）key 直接打出去。
     * 约束：不弹 token 钳制确认窗——emit 是 await 的，弹窗会卡死独立流请求。
     */
    async function routeFallbackIfNeeded(generateData: Record<string, any>): Promise<void> {
        const type = String(generateData?.type || 'normal');
        const activeGroup = deps.getGroups().find(group => group.id === deps.getActiveGroupId()) || deps.getGroups()[0] || null;
        const logicalModelId = activeGroup?.currentLogicalModelId ?? '';
        let unit: GroupRouteUnit | null = null;
        if (type !== 'quiet' && type !== 'continue' && type !== 'impersonate') {
            // 用户主动触发：优先消费手动锁定（对 MClite/独立流同样生效）
            unit = consumeManualLock(activeGroup, logicalModelId);
        }
        if (!unit) {
            const result = resolveFallbackRoute({
                type,
                routingEnabled: deps.getRouting().enabled,
                activeGroupId: deps.getActiveGroupId(),
                groups: deps.getGroups(),
                vendors: deps.getVendors(),
                stickyCount: deps.getRouting().stickyCount,
                lastPicked: state.lastPicked,
            });
            state.lastPicked = result.nextLastPicked;
            if (result.skipReason) {
                debugLog('onChatCompletionSettingsReady fallback skip', { reason: result.skipReason });
                return;
            }
            if (!result.unit) return;
            unit = result.unit;
        }
        await ensureEntrySecret(unit);
        const clamps = computeVendorTokenClamps(unit.vendor, {
            maxContext: Number(oai_settings.openai_max_context) || 0,
            maxOutputTokens: Number(oai_settings.openai_max_tokens) || 0,
        });
        const needsApply = clamps.maxContext !== undefined || clamps.maxOutputTokens !== undefined;
        if (needsApply) {
            // 独立流无弹窗阶段：跳过钳制，避免卡死请求；正常流（GENERATION_STARTED 路径）仍会弹窗确认
            debugLog('onChatCompletionSettingsReady fallback: token clamps skipped (no popup in fallback)', { clamps });
        }
        patchGenerateData(generateData, unit, customParamsForUnit(unit));
        setOnlineStatus('Valid');
        toastr.info(`Quicker Api：${unit.vendor.name} / ${unit.entry.label} / ${unit.realModel}`, '已路由', { timeOut: 8000 });
        debugLog('onChatCompletionSettingsReady fallback routed', {
            vendorName: unit.vendor.name,
            entryLabel: unit.entry.label,
            realModel: unit.realModel,
            source: generateData.chat_completion_source,
            endpoint: generateData.custom_url ?? generateData.reverse_proxy,
            model: generateData.model,
            hasKey: Boolean(generateData.secret_id ?? generateData.proxy_password),
            tokenClampsSkipped: needsApply,
            stConnectionSynced: true,
        });
    }

    function onGenerationStopped(): void {
        const vendor = state.active?.unit?.vendor ?? null;
        debugLog('onGenerationStopped', {
            hadActive: Boolean(state.active),
            presetTransitionBlocked: runtimeState.presetTransitionBlocked,
            activeVendor: vendor?.name ?? null,
        });
        if (vendor && vendor.window.length > 0) {
            vendor.window.pop();
            debugLog('onGenerationStopped RPM rolled back', { vendorName: vendor.name, windowSize: vendor.window.length });
        }
        state.userStopPending = true;
        state.active = null;
        deps.endGeneration?.();
    }

    function onGenerationEnded(): void {
        debugLog('onGenerationEnded enter', {
            hadActive: Boolean(state.active),
            userStopPending: state.userStopPending,
            presetTransitionBlocked: runtimeState.presetTransitionBlocked,
        });
        const active = state.active;
        if (!active) {
            debugLog('onGenerationEnded skip: no active route');
            return;
        }
        state.active = null;
        const probe = deps.endGeneration?.() ?? null;
        const { vendor, entry, realModel } = active.unit;
        const displayName = `${vendor.name} / ${entry.label} / ${realModel}`;
        debugLog('onGenerationEnded active route', { displayName, failed: Boolean(probe) });
        setTimeout(() => {
            if (state.userStopPending) {
                state.userStopPending = false;
                debugLog('onGenerationEnded user stop, ignored');
                return;
            }
            const routing = deps.getRouting();
            // 不论成功失败，都记录 Vendor 成功率（用于 UI 展示和路由加权）
            if (!probe) {
                recordVendorSuccess(vendor);
                recordModelSuccess(entry, realModel);
                saveSettingsDebounced();
                debugLog('onGenerationEnded recorded success', { vendorName: vendor.name, realModel });
                return;
            }
            if (probe.kind === 'empty_response') {
                // 空回复只保留诊断观测，不计入 Vendor/模型失败，不触发冷却。
                recordModelObservation(entry, realModel, probe.kind, probe.message);
                deps.recordObservation?.({
                    occurredAt: Date.now(),
                    groupId: active.groupId,
                    vendorId: vendor.id,
                    entryId: entry.id,
                    realModel,
                    logicalModelId: active.logicalModelId,
                    kind: probe.kind,
                    message: probe.message,
                });
                saveSettingsDebounced();
                debugLog('onGenerationEnded recorded empty response observation', { vendorName: vendor.name, realModel });
                return;
            }
            // 失败：模型级记账（Key × realModel 粒度），不自动禁用整个 Vendor
            const cooling = recordModelFailure(entry, realModel, probe.kind, probe.message, {
                threshold: routing.failThreshold,
                baseCooldownMs: routing.cooldownSeconds * 1000,
            });
            deps.recordObservation?.({
                occurredAt: Date.now(),
                groupId: active.groupId,
                vendorId: vendor.id,
                entryId: entry.id,
                realModel,
                logicalModelId: active.logicalModelId,
                kind: probe.kind,
                message: probe.message,
            });
            // 保持 Vendor 失败计数（用于 UI 展示和路由加权），但不触发 Vendor 级禁用
            vendor.failures = (Number(vendor.failures) || 0) + 1;
            saveSettingsDebounced();
            debugLog('onGenerationEnded recorded model failure', {
                vendorName: vendor.name,
                entryLabel: entry.label,
                realModel,
                kind: probe.kind,
                cooling,
            });
            if (cooling) {
                toastr.warning(`Quicker Api：${displayName} 失败已达阈值，已临时冷却（模型级，不影响其他模型）。`);
            } else {
                toastr.warning(`Quicker Api：${displayName} 本次生成失败已记录（模型级熔断）。`);
            }
        }, USER_STOP_GRACE_MS);
    }

    /**
     * 消费手动锁定（一次性）：若存在锁定且仍适用于当前分组/逻辑模型且可用，
     * 记录 RPM 并返回锁定 unit；否则返回 null，调用方回退随机选路。
     * 消费即清除，下下次恢复随机。
     */
    function consumeManualLock(activeGroup: Group | null, logicalModelId: string): GroupRouteUnit | null {
        const locked = state.manualLockedUnit;
        if (!locked) return null;
        state.manualLockedUnit = null;
        if (!isManualLockApplicable(locked, activeGroup, logicalModelId)) {
            debugLog('manual lock invalid, fallback to random');
            return null;
        }
        recordGroupSelection(locked);
        debugLog('manual lock consumed', {
            vendorName: locked.vendor.name,
            entryLabel: locked.entry.label,
            realModel: locked.realModel,
        });
        return locked;
    }

    function lockManualRoute(unit: GroupRouteUnit): void {
        state.manualLockedUnit = unit;
        debugLog('manual route locked', {
            vendorName: unit.vendor.name,
            entryLabel: unit.entry.label,
            realModel: unit.realModel,
        });
    }

    return {
        onGenerationStarted,
        onChatCompletionSettingsReady,
        onGenerationStopped,
        onGenerationEnded,
        getActiveUnit: () => state.active?.unit ?? null,
        lockManualRoute,
    };
}