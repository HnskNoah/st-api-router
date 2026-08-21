import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiErrorResponseMessage, createFailureObserver, type FailureObserver } from '../src/routing/failure-observer.js';

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
        emitToastrError('Failed to fetch', 'Chat Completion API');
        expect(observer.end()).toBeNull();
    });

    it('returns probe with kind and message when failure matches title', () => {
        observer.begin();
        emitToastrError('some message', 'Chat Completion API error');
        const probe = observer.end();
        expect(probe).not.toBeNull();
        expect(probe!.message).toBe('some message');
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
        emitToastrError('some info message', 'Some Other Title');
        expect(observer.end()).toBeNull();
    });

    it('resets state after end(), next begin() shows fresh result', () => {
        observer.begin();
        emitToastrError('Failed to fetch', 'Chat Completion API');
        expect(observer.end()).not.toBeNull();
        observer.begin();
        expect(observer.end()).toBeNull();
    });
});

describe('apiErrorResponseMessage', () => {
    it.each([
        '[API错误] model not found',
        '[API 错误] model not found',
        '[API Error] model not found',
        '【API错误】model not found',
        '【 API 错误 】 model not found',
        '\uFEFF  [ API\u00A0错误 ]  model not found',
    ])('recognizes common marker format: %s', text => {
        expect(apiErrorResponseMessage(text)).toBe(text.trim());
    });

    it('does not classify an ordinary response that mentions the marker later', () => {
        expect(apiErrorResponseMessage('正常内容：[API错误] not an API response')).toBeNull();
    });
});

describe('failure-observer response text', () => {
    it('returns a fatal probe for a marked response body', () => {
        observer.begin();
        observer.observeResponseText('[API 错误] model not found');
        const probe = observer.end();
        expect(probe).not.toBeNull();
        expect(probe!.kind).toBe('fatal');
        expect(probe!.message).toBe('[API 错误] model not found');
    });

    it('ignores an unmarked response body', () => {
        observer.begin();
        observer.observeResponseText('ordinary model response');
        expect(observer.end()).toBeNull();
    });
});

describe('failure-observer empty response', () => {
    it('returns an empty_response observation for a blank assistant response', () => {
        observer.begin();
        observer.observeResponseText('   ');
        expect(observer.end()).toEqual({ kind: 'empty_response', message: '[EMPTY_RESPONSE]' });
    });

    it('does not treat undefined as an empty response', () => {
        observer.begin();
        observer.observeResponseText(undefined);
        expect(observer.end()).toBeNull();
    });

    it('prioritizes an API error over an earlier blank response', () => {
        observer.begin();
        observer.observeResponseText('');
        observer.observeResponseText('[API错误] model not found');
        expect(observer.end()?.kind).toBe('fatal');
    });
});