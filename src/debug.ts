// 调试日志：内存缓冲默认始终收集，因此路由面板的「导出日志」可直接导出最近一次会话的日志。
// 如需同时在 DevTools Console 实时查看，可在控制台执行
//   localStorage.setItem('quickerApi.debugLog', '1')
// 后刷新页面开启；关闭：localStorage.removeItem('quickerApi.debugLog') 后刷新。

const DEBUG_KEY = 'quickerApi.debugLog';
const MAX_BUFFER_LINES = 5000;

let enabled = false;
let seq = 0;
const buffer: string[] = [];

export function isDebugLogEnabled(): boolean {
    return enabled;
}

export function setDebugLogEnabled(value: boolean): void {
    enabled = value;
}

export function initDebugLog(): void {
    enabled = typeof localStorage !== 'undefined' && localStorage.getItem(DEBUG_KEY) === '1';
    if (enabled) console.log('[ST Api Router] debug log enabled');
}

/** 记录结构化日志并带时间戳/自增序号；始终进入导出缓冲，仅开启开关时同步输出到 Console。 */
export function debugLog(...args: unknown[]): void {
    seq += 1;
    const time = new Date().toISOString().slice(11, 23);
    const line = `[ST Api Router] #${seq} ${time} ${formatArgs(args)}`;
    if (enabled) console.log(line);
    buffer.push(line);
    if (buffer.length > MAX_BUFFER_LINES) buffer.splice(0, buffer.length - MAX_BUFFER_LINES);
}

function formatArgs(args: unknown[]): string {
    try {
        return args.map(arg => {
            if (typeof arg === 'string') return arg;
            try {
                return JSON.stringify(arg);
            } catch {
                return String(arg);
            }
        }).join(' ');
    } catch {
        return args.map(String).join(' ');
    }
}

/** 把当前会话已缓存的调试日志导出为 .log 文件（浏览器下载，不写 ST 服务器文件）。 */
export function exportDebugLog(): void {
    if (buffer.length === 0) {
        console.log('[ST Api Router] no debug log lines buffered yet');
        toastr.info('当前还没有可导出的调试日志。');
        return;
    }
    const body = buffer.join('\n') + '\n';
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st-api-router-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    console.log(`[ST Api Router] exported ${buffer.length} log lines`);
}

declare global {
    interface Window {
        __quickerApiExportLog?: () => void;
    }
}

window.__quickerApiExportLog = exportDebugLog;
