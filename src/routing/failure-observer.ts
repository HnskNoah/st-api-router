// 失败观察（只读）：在「路由生成窗口」内识别真正的生成错误消息。
// 信号包括宿主的 Chat Completion toast、网络类 toast，及被渠道直接写入生成正文的 [API错误] 标记。
// 用户停止是静默的（无 toast），由 routing-hooks 的 STOPPED 守卫排除。
// end() 返回 FailureProbe（含分类与消息），供模型级熔断使用。

import { classifyModelFailureMessage } from '../domain/model-health.js';
import type { ModelObservationKind } from '../types.js';

const FAILURE_TITLE_FRAGMENT = 'chat completion';
const FAILURE_MESSAGE_PATTERN = /failed to fetch|load failed|network|timed out|abort/i;
const API_ERROR_RESPONSE_PATTERN = /^\s*(?:\[|【)\s*api\s*(?:错误|error)\s*(?:\]|】)\s*/iu;

type ToastrErrorMethod = (message: string | JQuery<HTMLElement>, title?: string, options?: any) => any;

export interface FailureProbe {
    kind: ModelObservationKind;
    /** 原始错误或结果观测文本（截断）。 */
    message: string;
}

export interface FailureObserver {
    install(): void;
    uninstall(): void;
    begin(): void;
    /** 记录已写入聊天正文的 API 错误文本或空回复。 */
    observeResponseText(text: unknown): void;
    /** 路由窗口结束；返回 null 表示无观测，非 null 表示错误或空回复。 */
    end(): FailureProbe | null;
}

export function apiErrorResponseMessage(text: unknown): string | null {
    const message = String(text ?? '').trim();
    if (!API_ERROR_RESPONSE_PATTERN.test(message)) return null;
    return message.slice(0, 500);
}

export function createFailureObserver(): FailureObserver {
    const state = { active: false, failed: false, emptyResponse: false, lastMessage: '' };
    let originalError: ToastrErrorMethod | null = null;

    function resetState(): void {
        state.failed = false;
        state.emptyResponse = false;
        state.lastMessage = '';
    }

    function isFailureMessage(message: unknown, title: unknown): boolean {
        const t = String(title ?? '').toLowerCase();
        if (t.includes(FAILURE_TITLE_FRAGMENT)) return true;
        const m = String(message ?? '').toLowerCase();
        return FAILURE_MESSAGE_PATTERN.test(m);
    }

    function install(): void {
        if (originalError) return;
        originalError = toastr.error.bind(toastr) as ToastrErrorMethod;
        toastr.error = function (message: string | JQuery<HTMLElement>, title?: string, options?: any) {
            if (state.active && isFailureMessage(message, title)) {
                state.failed = true;
                state.emptyResponse = false;
                state.lastMessage = String(message ?? '');
            }
            return originalError!(message, title, options);
        } as ToastrErrorMethod;
    }

    function uninstall(): void {
        if (originalError) toastr.error = originalError;
        originalError = null;
        state.active = false;
        resetState();
    }

    /** 路由窗口开始（STARTED 应用成功后调用）。 */
    function begin(): void {
        state.active = true;
        resetState();
    }

    function observeResponseText(text: unknown): void {
        if (!state.active) return;
        const message = apiErrorResponseMessage(text);
        if (message) {
            state.failed = true;
            state.emptyResponse = false;
            state.lastMessage = message;
            return;
        }
        if (typeof text === 'string' && text.trim() === '' && !state.failed) {
            state.emptyResponse = true;
            return;
        }
        if (typeof text === 'string' && text.trim() !== '') state.emptyResponse = false;
    }

    /** 路由窗口结束；返回 null 表示无观测，非 null 表示错误或空回复。 */
    function end(): FailureProbe | null {
        state.active = false;
        const failed = state.failed;
        const emptyResponse = state.emptyResponse;
        const message = state.lastMessage;
        resetState();
        if (failed) {
            return {
                kind: classifyModelFailureMessage(message),
                message: String(message ?? '').slice(0, 500),
            };
        }
        if (emptyResponse) {
            return { kind: 'empty_response', message: '[EMPTY_RESPONSE]' };
        }
        return null;
    }

    return { install, uninstall, begin, observeResponseText, end };
}