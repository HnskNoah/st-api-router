// 失败观察（只读）：在「路由生成窗口」内识别真正的生成错误消息。
// 识别规则：title 为 'Chat Completion API'（宿主 API 错误路径），
// 或消息命中网络类错误模式（Failed to fetch / Load failed / timeout / abort）。
// 用户停止是静默的（无 toast），由 routing-hooks 的 STOPPED 守卫排除。
// 升级：end() 返回 FailureProbe（含分类与消息），而非仅 boolean，供模型级熔断使用。

import { classifyModelFailureMessage } from '../domain/model-health.js';
import type { ModelFailureKind } from '../types.js';

const FAILURE_TITLE_FRAGMENT = 'chat completion';
const FAILURE_MESSAGE_PATTERN = /failed to fetch|load failed|network|timed out|abort/i;

type ToastrErrorMethod = (message: string | JQuery<HTMLElement>, title?: string, options?: any) => any;

export interface FailureProbe {
    kind: ModelFailureKind;
    /** 原始错误消息（截断）。 */
    message: string;
}

export interface FailureObserver {
    install(): void;
    uninstall(): void;
    begin(): void;
    /** 路由窗口结束；返回 null 表示无失败，非 null 表示失败（含分类与消息）。 */
    end(): FailureProbe | null;
}

export function createFailureObserver(): FailureObserver {
    const state = { active: false, failed: false, lastMessage: '' };
    let originalError: ToastrErrorMethod | null = null;

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
                state.lastMessage = String(message ?? '');
            }
            return originalError!(message, title, options);
        } as ToastrErrorMethod;
    }

    function uninstall(): void {
        if (originalError) toastr.error = originalError;
        originalError = null;
        state.active = false;
        state.failed = false;
        state.lastMessage = '';
    }

    /** 路由窗口开始（STARTED 应用成功后调用）。 */
    function begin(): void {
        state.active = true;
        state.failed = false;
        state.lastMessage = '';
    }

    /** 路由窗口结束（ENDED/STOPPED 调用）；返回 null 表示无失败，非 null 表示失败（含分类与消息）。 */
    function end(): FailureProbe | null {
        state.active = false;
        const failed = state.failed;
        const message = state.lastMessage;
        state.failed = false;
        state.lastMessage = '';
        if (!failed) return null;
        return {
            kind: classifyModelFailureMessage(message),
            message: String(message ?? '').slice(0, 500),
        };
    }

    return { install, uninstall, begin, end };
}