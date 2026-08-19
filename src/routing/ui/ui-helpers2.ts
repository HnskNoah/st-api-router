// UI 辅助纯函数（第二组）：纯展示与格式化函数，无 deps/panel 闭包依赖。
// 只依赖自身参数 + 导入的类型/常量，可安全独立测试。

import type { Vendor } from '../../types.js';

export const FORMAT_LABELS: Record<string, string> = { 'custom': 'OpenAI 兼容', 'deepseek': 'DeepSeek' };

export function statusBadge(reason: string | null): string {
    const label: Record<string, string> = { disabled: '禁用', rpm: '限流' };
    return `<span class="st-router-badge st-router-badge--${reason ?? 'ok'}">${reason ? (label[reason] ?? reason) : '可用'}</span>`;
}

export function vendorStatus(vendor: Vendor, now = Date.now()): string | null {
    if (!vendor || vendor.enabled === false) return 'disabled';
    const { window } = windowForVendor(vendor, now);
    const rpm = Number(vendor.rpm) || 0;
    if (rpm > 0 && window.length >= rpm) return 'rpm';
    return null;
}

export function windowForVendor(vendor: Vendor, now: number): { window: number[]; count: number } {
    const cutoff = now - 60 * 1000;
    const window = (vendor?.window || []).filter(ts => typeof ts === 'number' && ts > cutoff);
    return { window, count: window.length };
}

export function successRateText(vendor: Vendor): string {
    const total = (Number(vendor.successes) || 0) + (Number(vendor.failures) || 0);
    if (total <= 0) return '无历史';
    return `${Math.round((Number(vendor.successes) || 0) / total * 100)}%`;
}

/** 把毫秒格式化为人类可读时长（如 5m 20s / 1h 30m / 6h）。 */
export function formatCooldownMs(ms: number): string {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    if (total < 60) return `${total}s`;
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return h > 0 ? (rm > 0 ? `${h}h ${rm}m` : `${h}h`) : `${rm}m`;
}

export function field(labelText: string, control: JQuery<HTMLElement>, hint = ''): JQuery<HTMLElement> {
    const label = $('<label></label>').append($('<span>').text(labelText));
    if (hint) label.append($('<span class="quicker-api__field-hint" title=""></span>').attr('title', hint).text('?'));
    return $('<div class="quicker-api__field"></div>').append(label, control);
}