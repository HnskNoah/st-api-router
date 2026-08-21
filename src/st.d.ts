// 自包含的宿主模块声明 —— 只覆盖 ST-Quicker-Api 实际用到的 API。
// 构建时由 vite stResolver 重写为绝对路径并 external，本文件仅供类型检查。

declare module '@sillytavern/script' {
    export function getRequestHeaders(options?: { omitContentType?: boolean }): Record<string, string>;
    export function saveSettingsDebounced(loopCounter?: number): void;
    export function setOnlineStatus(value: string): void;
    export const eventSource: {
        emit(event: string, ...args: unknown[]): Promise<boolean>;
        on(event: string, listener: (...args: any[]) => unknown): void;
        makeLast(event: string, listener: (...args: any[]) => unknown): void;
        removeListener(event: string, listener: (...args: any[]) => unknown): void;
        [key: string]: unknown;
    };
    export const event_types: Record<string, string>;
    export const chat: Array<{ mes?: unknown }>;
}

declare module '@sillytavern/scripts/openai' {
    export const chat_completion_sources: Record<string, string>;
    export const oai_settings: Record<string, any>;
    export const proxies: any[];
}

declare module '@sillytavern/scripts/secrets' {
    export const SECRET_KEYS: Record<string, string>;
    export const secret_state: Record<string, any>;
    export function writeSecret(key: string, value: string, label?: string): Promise<string | null>;
}

declare module '@sillytavern/scripts/popup' {
    export const POPUP_TYPE: Record<string, string>;
    export class Popup {
        static show: Record<string, (...args: any[]) => Promise<any>>;
        constructor(
            content: JQuery<HTMLElement> | string,
            type: string,
            inputValue?: string,
            popupOptions?: Record<string, any>,
        );
        show(): Promise<string | null>;
        complete(result: string | number): Promise<void>;
        completeCancelled(): Promise<void>;
        completeAffirmative(): Promise<void>;
    }
}

declare module '@sillytavern/scripts/extensions' {
    export const extension_settings: Record<string, any>;
}
