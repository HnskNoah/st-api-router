// 调试日志：默认关闭，不影响生产；在 DevTools Console 执行
//   localStorage.setItem('quickerApi.debugLog', '1')
// 后刷新页面即可开启。关闭：localStorage.removeItem('quickerApi.debugLog') 后刷新。

const DEBUG_KEY = 'quickerApi.debugLog';

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
    if (enabled) {
        buffer.length = 0;
        console.log('[ST Api Router] debug log enabled');
    }
}

/** 在开启调试时输出结构化日志，带时间戳和自增序号，方便排查循环/重复触发。 */
export function debugLog(...args: unknown[]): void {
    if (!enabled) return;
    seq += 1;
    const time = new Date().toISOString().slice(11, 23);
    const line = `[ST Api Router] #${seq} ${time} ${formatArgs(args)}`;
    console.log(line);
    buffer.push(line);
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

/** 把已缓存的调试日志导出为 .log 文件（浏览器下载，不写 ST 服务器文件）。 */
export function exportDebugLog(): void {
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
