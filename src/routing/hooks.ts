// 路由钩子：生成前选路（key 粒度）并写回 ST；结束后按失败观察结果计数/熔断。
// 不重发：失败只记录（failStreak/熔断），下一轮生成自然轮到其他 key。
// sticky 按绝对时间：窗口内固定 key，换对话/角色/模型都不重置。

import { routeOnce, recordSuccess, recordFailure } from '../domain/routing.js';
import { aggregateModels } from '../domain/model-catalog.js';
import { applyProviderConnection, snapshotConnection, restoreConnection } from './apply-provider.js';
import type { LastPicked, Provider, RoutingSettings, RoutingUnit } from '../types.js';

const USER_STOP_GRACE_MS = 50;

export interface RoutingHooksDeps {
    getProviders(): Provider[];
    getRouting(): RoutingSettings;
    getCurrentModel(): string;
    beginGeneration?(): void;
    endGeneration?(): boolean;
}

export interface RoutingHooks {
    onGenerationStarted(): void;
    onGenerationStopped(): void;
    onGenerationEnded(): void;
    getActiveUnit(): RoutingUnit | null;
}

export function createRoutingHooks(deps: RoutingHooksDeps): RoutingHooks {
    const state: {
        active: { unit: RoutingUnit; model: string } | null;
        lastPicked: LastPicked | null;
        userStopPending: boolean;
    } = {
        active: null,
        lastPicked: null,
        userStopPending: false,
    };

    function onGenerationStarted(): void {
        const routing = deps.getRouting();
        if (!routing.enabled) return;
        const model = deps.getCurrentModel();
        if (!model) return;
        const providers = deps.getProviders();
        if (!aggregateModels(providers).includes(model)) return; // 不在聚合清单 → 不干预

        const result = routeOnce(providers, model, {
            stickySeconds: Number(routing.stickySeconds) || 0,
            lastPicked: state.lastPicked,
        });
        if (!result.unit) {
            toastr.warning(`st-api-router：模型「${model}」当前无可用供应商（${result.reasons.join('；')}）。`);
            return;
        }
        const snapshot = snapshotConnection();
        try {
            applyProviderConnection(result.unit.provider, result.unit.key, model);
        } catch (error) {
            console.error('[st-api-router] apply provider failed:', error);
            restoreConnection(snapshot);
            toastr.error('st-api-router：供应商连接应用失败，已恢复原连接。');
            return;
        }
        state.active = { unit: result.unit, model };
        if (result.nextLastPicked) state.lastPicked = result.nextLastPicked;
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
        const routing = deps.getRouting();
        const unit = active.unit;
        const displayName = `${unit.provider?.name} / ${unit.key?.label}`;
        // 用户停止：ENDED 先于 STOPPED 触发，稍等再判定
        setTimeout(() => {
            if (state.userStopPending) {
                state.userStopPending = false;
                return;
            }
            if (!failed) {
                recordSuccess(unit, active.model);
                return;
            }
            recordFailure(unit, active.model, 'generation failed', {
                threshold: routing.failThreshold,
                cooldownMs: routing.cooldownSeconds * 1000,
            });
            if ((unit.key.circuits[active.model] ?? 0) > Date.now()) {
                toastr.warning(`st-api-router：供应商「${displayName}」连续失败已熔断 ${routing.cooldownSeconds} 秒，后续将自动改用其他 key。`);
            } else {
                toastr.warning(`st-api-router：供应商「${displayName}」本次生成失败已记录；连续失败将触发熔断。`);
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
