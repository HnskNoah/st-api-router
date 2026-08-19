// 控制台 UI 共享辅助函数：纯展示/格式化/健康判断，无 DOM 渲染依赖。
// 被 dashboard / route-detail / right-* 各模块共用。

import { groups, logicalModels, routingSettings, settings, vendors } from '../../settings/access.js';
import { groupUnitsForLogicalModel, type GroupRouteUnit } from '../../domain/group-routing.js';
import { isModelInCooldown } from '../../domain/model-health.js';
import { saveSettingsDebounced } from '@sillytavern/script';

// ── 数据访问 ──

export function activeGroup() {
    const id = settings().activeGroupId;
    return groups().find(group => group.id === id) || groups()[0] || null;
}

export function saveSettingsNow(): void {
    saveSettingsDebounced();
}

// ── 格式化 ──

export function formatDur(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m${s % 60 ? ` ${s % 60}s` : ''}`;
    const h = Math.floor(m / 60);
    return h > 0 ? `${h}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
}

export function levelDot(level: 'ok' | 'warn' | 'error' | 'empty'): string {
    const cls = { ok: 'ok', warn: 'warn', error: 'error', empty: 'empty' }[level];
    return `<span class="csl-dot csl-dot--${cls}"></span>`;
}

// ── 健康判断 ──

export function routeHealth(unit: GroupRouteUnit, now: number): { state: 'healthy' | 'cooldown' | 'disabled'; remaining?: number } {
    if (unit.vendor.enabled === false || unit.entry.enabled === false) return { state: 'disabled' };
    if (isModelInCooldown(unit.entry, unit.realModel, now)) {
        const until = unit.entry.circuitsByModel?.[unit.realModel] ?? 0;
        return { state: 'cooldown', remaining: Math.max(0, until - now) };
    }
    return { state: 'healthy' };
}

export interface ModelStatus {
    level: 'ok' | 'warn' | 'error' | 'empty';
    text: string;
    healthy: number;
    cooling: number;
    disabled: number;
    best: GroupRouteUnit | null;
    units: GroupRouteUnit[];
}

export function modelStatus(logicalId: string): ModelStatus {
    const group = activeGroup();
    const units = group ? groupUnitsForLogicalModel(vendors(), group, logicalId) : [];
    if (units.length === 0) return { level: 'empty', text: '未配置', healthy: 0, cooling: 0, disabled: 0, best: null, units };
    const now = Date.now();
    let healthy = 0, cooling = 0, disabled = 0;
    let best: GroupRouteUnit | null = null;
    for (const unit of units) {
        const h = routeHealth(unit, now);
        if (h.state === 'healthy') { healthy++; if (!best) best = unit; }
        else if (h.state === 'cooldown') cooling++;
        else disabled++;
    }
    if (healthy > 0) return { level: 'ok', text: `${healthy} 条可用`, healthy, cooling, disabled, best, units };
    if (cooling > 0) return { level: 'warn', text: `${cooling} 条冷却中`, healthy, cooling, disabled, best, units };
    return { level: 'error', text: '无可用路由', healthy, cooling, disabled, best, units };
}

// ── UI 辅助 ──

export function cslField(label: string, control: JQuery<HTMLElement>, hint = ''): JQuery<HTMLElement> {
    const wrap = $('<label class="csl-field"></label>');
    const labelSpan = $('<span class="csl-field-label">').text(label);
    if (hint) labelSpan.append($('<span class="quicker-api__field-hint" title=""></span>').attr('title', hint).text('?'));
    wrap.append(labelSpan, control);
    return wrap;
}

export function cslCheckbox(value: boolean, onChange: (v: boolean) => void): JQuery<HTMLElement> {
    return $('<input type="checkbox">').prop('checked', value).on('change', function () { onChange($(this).prop('checked')); });
}

export function cslNumber(value: number, onChange: (v: number) => void): JQuery<HTMLElement> {
    return $('<input class="text_pole csl-num" type="number" min="0" step="1">').val(value).on('change', function () { onChange(Number($(this).val()) || 0); });
}