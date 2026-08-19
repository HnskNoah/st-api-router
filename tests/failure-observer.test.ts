import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFailureObserver, type FailureObserver } from '../src/routing/failure-observer.js';

function stubToastr(): void {
    (globalThis as any).toastr = { error: vi.fn(() => undefined) as any };
}

let observer: FailureObserver;

beforeEach(() => {
    stubToastr();
    observer = createFailureObserver();
    observer.install();
});

afterEach(() => {
    observer.uninstall();
    delete (globalThis as any).toastr;
});

/** 调用 patched toastr.error（走观察器拦截逻辑）。 */
function emitToastrError(message: string, title?: string): void {
    (globalThis as any).toastr.error(message, title);
}

describe('failure-observer end()', () => {
    it('returns null when no failure detected', () => {
        observer.begin();
        expect(observer.end()).toBeNull();
    });

    it('returns null when failure detected outside active window', () => {
        // 未 begin，窗口未激活
        emitToastrError('Failed to fetch', 'Chat Completion API');
        expect(observer.end()).toBeNull();
    });

    it('returns probe with kind and message when failure matches title', () => {
        observer.begin();
        emitToastrError('some message', 'Chat Completion API error');
        const probe = observer.end();
        expect(probe).not.toBeNull();
        expect(probe!.message).toBe('some message');
        // 消息不含分类关键词 → unknown（title 命中失败）
        expect(probe!.kind).toBe('unknown');
    });

    it('classifies network failure message as temp', () => {
        observer.begin();
        emitToastrError('Failed to fetch');
        const probe = observer.end();
        expect(probe).not.toBeNull();
        expect(probe!.kind).toBe('temp');
        expect(probe!.message).toBe('Failed to fetch');
    });

    it('classifies timeout as temp', () => {
        observer.begin();
        emitToastrError('Request timed out', 'Chat Completion API');
        const probe = observer.end();
        expect(probe).not.toBeNull();
        expect(probe!.kind).toBe('temp');
    });

    it('classifies rate limit message as rate_limited', () => {
        observer.begin();
        emitToastrError('429 rate limit exceeded', 'Chat Completion API');
        const probe = observer.end();
        expect(probe).not.toBeNull();
        expect(probe!.kind).toBe('rate_limited');
    });

    it('does not mark non-failure toasts as failure', () => {
        observer.begin();
        // 不匹配失败模式 → 不算失败
        emitToastrError('some info message', 'Some Other Title');
        expect(observer.end()).toBeNull();
    });

    it('resets state after end(), next begin() shows fresh result', () => {
        observer.begin();
        emitToastrError('Failed to fetch', 'Chat Completion API');
        expect(observer.end()).not.toBeNull();
        // 新一轮 begin：不触发失败
        observer.begin();
        expect(observer.end()).toBeNull();
    });
});