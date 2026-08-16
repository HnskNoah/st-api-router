// 全局挂载补充声明（宿主运行时注入的对象）。
export {};

declare global {
    interface Window {
        presetCards?: {
            loadProfile?: (presetName: string, profileId: string) => Promise<boolean>;
            listPresets?: () => string[];
            getProfiles?: (presetName: string) => { id: string; name: string }[];
        };
    }
    var Popper: { createPopper?: (ref: Element, popper: Element, options?: Record<string, unknown>) => { destroy?: () => void } | null } | undefined;
    var toastr: Toastr;
    interface JQuery<TElement = HTMLElement> {
        select2(options?: Record<string, unknown>): this;
        select2(method: 'destroy' | 'open' | 'close' | string, ...args: unknown[]): this;
    }
}
