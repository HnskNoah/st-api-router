// 自动重试链状态机：失败/空回复后排定「换路由重试」（排除已失败渠道，延时重触发），
// 并决定每次 GENERATION_STARTED 如何消费挂起链：
//   self    = 我们排定的重试到场（类型与排定一致：regenerate 或 swipe），链继续；
//   inherit = 窗口内的自动生成（群聊自动模式、QR 脚本等 automatic_trigger 触发）接管链，本次生成即重试；
//   fresh   = 用户新发起或窗口过期，清链重新开始。
// 只管链状态与决策，不碰 generateData / oai_settings。

import { autoRetryDelayMs, classifyRetryChainStart, evaluateAutoRetry, groupUnitKey, type GroupRouteUnit, type RetryChainAction } from '../domain/group-routing.js';
import { runtimeState } from '../state.js';
import { debugLog } from '../debug.js';
import type { Group, RoutingSettings } from '../types.js';

/** 每次自动重试额外随机抖动（0～500ms），避免多客户端/多轮重试同步打爆渠道。 */
const AUTO_RETRY_JITTER_MS = 500;
/** retryScheduled 认领窗口下限：超过视为已失效（防止误消费）。 */
const AUTO_RETRY_SCHEDULE_WINDOW_MS = 15_000;
/** 窗口在「延迟+抖动」之上的余量：覆盖 50ms 记账宽限与事件调度开销。 */
const RETRY_CLAIM_SLACK_MS = 1_000;

export interface RetryChainDeps {
    getRouting(): RoutingSettings;
    getGroups(): Group[];
    getActiveGroupId(): string | null;
    isUserStopPending(): boolean;
    /** swipe 重试前置：清理上次失败遗留的尾随空变体槽（实现见 hooks）。 */
    prepareSwipeRetryTarget(): void;
}

export interface RetryFailureInput {
    unit: GroupRouteUnit;
    logicalModelId: string;
    /** 空回复与生成失败的提示文案区分；两者都触发重试。 */
    emptyResponse: boolean;
    /** 失败生成的类型：决定重试动作（swipe=再点最后一条的滑动箭头，其余=点击重新生成按钮）。 */
    originType: 'swipe' | 'regenerate';
}

export interface RetryChain {
    consumeStart(type: string | undefined, automaticTrigger: boolean): RetryChainAction;
    reset(): void;
    count(): number;
    isExcluded(unit: GroupRouteUnit): boolean;
    excludedKeys(): string[];
    /** 失败/空回复后决策：可重试则排定下一次换路由（含上限与环境变化检查）。 */
    handleFailure(input: RetryFailureInput): void;
    /** 插件拆卸时取消挂起重试并清链。 */
    dispose(): void;
}

export function createRetryChain(deps: RetryChainDeps): RetryChain {
    let count = 0;
    let scheduled = false;
    let scheduledAt = 0;
    let scheduledType: string = 'regenerate';
    const excluded = new Set<string>();
    let timer: number | null = null;

    function cancelPendingClick(): void {
        if (timer != null) {
            clearTimeout(timer);
            timer = null;
        }
    }

    function reset(): void {
        cancelPendingClick();
        count = 0;
        scheduled = false;
        scheduledAt = 0;
        excluded.clear();
    }

    function activeGroup(): Group | null {
        return deps.getGroups().find(item => item.id === deps.getActiveGroupId()) || deps.getGroups()[0] || null;
    }

    function consumeStart(type: string | undefined, automaticTrigger: boolean): RetryChainAction {
        // 认领窗口必须覆盖「延迟+抖动」：长延迟配置若被 15s 下限截断，自己的重试会被误判过期（fresh）——
        // 排除集丢失、计数清零，表现为无限重试
        const windowMs = Math.max(
            AUTO_RETRY_SCHEDULE_WINDOW_MS,
            deps.getRouting().autoRetryDelayMs + AUTO_RETRY_JITTER_MS + RETRY_CLAIM_SLACK_MS,
        );
        const action = classifyRetryChainStart({
            retryScheduled: scheduled,
            type,
            scheduledAt,
            now: Date.now(),
            windowMs,
            automaticTrigger,
            scheduledType,
        });
        scheduled = false;
        if (action === 'fresh') {
            reset();
        } else {
            // self：点击定时器已触发；inherit：本次生成即重试，点击定时器作废
            cancelPendingClick();
        }
        return action;
    }

    function handleFailure(input: RetryFailureInput): void {
        const routing = deps.getRouting();
        const group = activeGroup();
        const groupIntact = Boolean(group && group.enabled && group.currentLogicalModelId === input.logicalModelId);
        const decision = evaluateAutoRetry({
            autoRetryCount: routing.autoRetryCount,
            retriesUsed: count,
            routingEnabled: routing.enabled,
            extensionDisabled: runtimeState.extensionDisabled,
            presetTransitionBlocked: runtimeState.presetTransitionBlocked,
            groupIntact,
        });
        if (decision.canRetry) {
            excluded.add(groupUnitKey(input.unit));
            count = decision.attempt;
            scheduled = true;
            scheduledAt = Date.now();
            scheduledType = input.originType === 'swipe' ? 'swipe' : 'regenerate';
            const kindLabel = input.emptyResponse ? '空回复' : '生成失败';
            const delayMs = autoRetryDelayMs(routing.autoRetryDelayMs, AUTO_RETRY_JITTER_MS, Math.random());
            toastr.info(`Quicker Api：${kindLabel}，${(delayMs / 1000).toFixed(1).replace(/\.0$/, '')}s 后自动换路由重试（${decision.attempt}/${routing.autoRetryCount}）。`);
            timer = window.setTimeout(() => {
                timer = null;
                if (!deps.getRouting().enabled || runtimeState.extensionDisabled) {
                    debugLog('auto retry cancelled: routing disabled');
                    reset();
                    return;
                }
                if (deps.isUserStopPending()) {
                    debugLog('auto retry cancelled: user stop');
                    reset();
                    return;
                }
                // 延时窗口内分组/逻辑模型可能被用户切换：此时不再重试，避免在错误目标上生成
                const currentGroup = activeGroup();
                if (!currentGroup || !currentGroup.enabled || currentGroup.currentLogicalModelId !== input.logicalModelId) {
                    debugLog('auto retry cancelled: group or logical model changed', {
                        currentLogicalModelId: currentGroup?.currentLogicalModelId ?? null,
                        expectedLogicalModelId: input.logicalModelId,
                    });
                    reset();
                    return;
                }
                if (document.body?.dataset?.generating) {
                    debugLog('auto retry cancelled: ST still generating');
                    reset();
                    return;
                }
                // swipe 失败走 ST 官方滑动入口（overswipe→重新生成），其余点 wand 菜单的重新生成
                let btn: HTMLElement | null;
                if (input.originType === 'swipe') {
                    deps.prepareSwipeRetryTarget();
                    btn = document.querySelector<HTMLElement>('.mes.last_mes .swipe_right') ?? null;
                } else {
                    btn = document.getElementById('option_regenerate');
                }
                if (!btn) {
                    debugLog('auto retry cancelled: retry control missing', { originType: input.originType });
                    reset();
                    return;
                }
                debugLog('auto retry: clicking retry control', { attempt: decision.attempt, originType: input.originType });
                btn.click();
            }, delayMs);
        } else if (routing.autoRetryCount > 0 && count >= routing.autoRetryCount) {
            toastr.warning(`Quicker Api：自动重试已达上限（${routing.autoRetryCount} 次），已停止。请检查 API 或手动重试。`);
            reset();
        } else if (count > 0) {
            // 环境变化（模型/分组切换、路由停用、预设切换等）→ 静默停止，不误报“已达上限”
            debugLog('auto retry stopped: environment changed', { retryCount: count, autoRetryCount: routing.autoRetryCount });
            reset();
        }
    }

    return {
        consumeStart,
        reset,
        dispose: () => reset(),
        count: () => count,
        isExcluded: unit => excluded.has(groupUnitKey(unit)),
        excludedKeys: () => [...excluded],
        handleFailure,
    };
}
