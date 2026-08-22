// 测试环境桩：被测模块在求值/运行期引用浏览器全局
// （debug.ts 顶层写 window.__quickerApiExportLog；retry-chain 运行期用 toastr 与 window.setTimeout）。
// 必须以侧效应模块形式排在所有被测导入之前，保证 ESM 求值顺序。
type TimeoutHandle = number;

const stubWindow = {
    setTimeout: (_callback: (...args: unknown[]) => void, _ms?: number): TimeoutHandle => 1,
    clearTimeout: (_handle: TimeoutHandle) => {},
};

Object.assign(globalThis, {
    window: stubWindow,
    toastr: { info: () => {}, warning: () => {}, error: () => {} },
});
