// 路由控制台（新 UI）：三栏浮层面板。
// 独立模块，直接读 settings/access + domain 纯函数，不依赖 ui.ts 闭包。
// 左栏 = 逻辑模型仪表盘（健康/最优路由）；中栏 = 路由详情；右栏 = 管理（占位）。

import { saveSettingsDebounced } from '@sillytavern/script';
import { groups, logicalModels, routingSettings, settings, vendors } from '../../settings/access.js';
import { groupUnitsForLogicalModel, type GroupRouteUnit } from '../../domain/group-routing.js';
import { isModelInCooldown } from '../../domain/model-health.js';

let panelEl: JQuery<HTMLElement> | null = null;
let selectedLogicalId: string | null = null;
let rightTab: 'route' | 'vendor' | 'settings' = 'route';

function activeGroup() {
    const id = settings().activeGroupId;
    return groups().find(group => group.id === id) || groups()[0] || null;
}

function logicalName(id: string | undefined | null): string {
    return logicalModels().find(model => model.id === id)?.name || '(未知)';
}

function formatDur(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m${s % 60 ? ` ${s % 60}s` : ''}`;
    const h = Math.floor(m / 60);
    return h > 0 ? `${h}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
}

function routeHealth(unit: GroupRouteUnit, now: number): { state: 'healthy' | 'cooldown' | 'disabled'; remaining?: number } {
    if (unit.vendor.enabled === false || unit.entry.enabled === false) return { state: 'disabled' };
    if (isModelInCooldown(unit.entry, unit.realModel, now)) {
        const until = unit.entry.circuitsByModel?.[unit.realModel] ?? 0;
        return { state: 'cooldown', remaining: Math.max(0, until - now) };
    }
    return { state: 'healthy' };
}

function modelStatus(logicalId: string): {
    level: 'ok' | 'warn' | 'error' | 'empty';
    text: string;
    healthy: number;
    cooling: number;
    disabled: number;
    best: GroupRouteUnit | null;
    units: GroupRouteUnit[];
} {
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

function levelDot(level: 'ok' | 'warn' | 'error' | 'empty'): string {
    const cls = { ok: 'ok', warn: 'warn', error: 'error', empty: 'empty' }[level];
    return `<span class="csl-dot csl-dot--${cls}"></span>`;
}

// ── 渲染 ──

function renderDashboard(): void {
    const listEl = dashboardEl;
    if (!listEl) return;
    listEl.empty();
    const group = activeGroup();
    if (!group) {
        listEl.append($('<div class="csl-empty">').text('还没有分组，先到路由面板配置。'));
        return;
    }
    const models = [...logicalModels()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    for (const model of models) {
        const status = modelStatus(model.id);
        const row = $('<div class="csl-model-row" role="button" tabindex="0"></div>')
            .toggleClass('is-selected', selectedLogicalId === model.id)
            .attr('data-search', model.name.toLowerCase());
        const name = $('<span class="csl-model-name"></span>');
        name.html(`${levelDot(status.level)} <span>${model.name}</span>`);
        const meta = $('<span class="csl-model-meta">').text(status.text);
        const sub = status.best
            ? $('<span class="csl-model-sub">').text(`${status.best.vendor.name} · ${status.best.entry.label} · ${status.best.realModel}`)
            : $('<span class="csl-model-sub csl-model-sub--empty">').text(status.text);
        row.append($('<span class="csl-model-top"></span>').append(name, meta), sub);
        row.on('click', () => { selectedLogicalId = model.id; renderRouteDetail(); });
        row.on('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.trigger('click'); } });
        listEl.append(row);
        if (status.cooling > 0) listEl.append($('<span class="csl-model-flag">').text(`⚠️ ${model.name} 有 ${status.cooling} 条冷却中`));
    }
    if (models.length === 0) {
        listEl.append($('<div class="csl-empty">').text('还没有逻辑模型。先从路由面板拉取模型并归类，或一键归类。'));
    }
}

function renderRouteDetail(): void {
    const detailElLocal = detailEl;
    if (!detailElLocal) return;
    detailElLocal.empty();
    if (!selectedLogicalId) {
        detailElLocal.append($('<div class="csl-empty">').text('在左侧选择一个逻辑模型查看路由详情。'));
        return;
    }
    const model = logicalModels().find(m => m.id === selectedLogicalId);
    const head = $('<div class="csl-detail-head"></div>').append(
        $('<span class="csl-detail-title">').text(model?.name ?? '路由详情'),
        $('<button class="menu_button" type="button" title="关闭返回"><i class="fa-solid fa-xmark"></i></button>').on('click', () => { selectedLogicalId = null; renderRouteDetail(); }),
    );
    detailElLocal.append(head);
    const status = modelStatus(selectedLogicalId);
    const now = Date.now();
    const units = [...status.units].sort((a, b) => {
        const ha = routeHealth(a, now).state, hb = routeHealth(b, now).state;
        const rank = { healthy: 0, cooldown: 1, disabled: 2 };
        return (rank[ha] ?? 3) - (rank[hb] ?? 3);
    });
    if (units.length === 0) {
        detailElLocal.append($('<div class="csl-empty">').text('该逻辑模型未配置任何 Key 映射。'));
        return;
    }
    const list = $('<div class="csl-route-list"></div>');
    for (const unit of units) {
        const h = routeHealth(unit, now);
        const pill = $('<div class="csl-route-row"></div>');
        const rowName = $('<span class="csl-route-name"></span>').text(`${unit.vendor.name} · ${unit.entry.label} · ${unit.realModel}`);
        const remaining = h.remaining != null ? ` · 冷却中 ${formatDur(h.remaining)}` : '';
        const stateText = h.state === 'healthy' ? '🟢' : h.state === 'cooldown' ? `🟡${remaining}` : '🔴';
        pill.append(rowName, $('<span class="csl-route-state">').text(stateText));
        if (h.state === 'cooldown' || h.state === 'disabled') {
            const resetBtn = $('<button class="menu_button" type="button" title="手动恢复该模型"><i class="fa-solid fa-rotate-left"></i></button>')
                .on('click', () => {
                    if (h.state === 'cooldown') {
                        if (unit.entry.circuitsByModel) delete unit.entry.circuitsByModel[unit.realModel];
                    } else if (h.state === 'disabled') {
                        unit.vendor.enabled = true;
                        unit.entry.enabled = true;
                    }
                    saveSettingsNow();
                    renderRouteDetail();
                    renderDashboard();
                });
            pill.append(resetBtn);
        }
        list.append(pill);
    }
    detailElLocal.append(list);
}

function saveSettingsNow(): void {
    saveSettingsDebounced();
}

let dashboardEl: JQuery<HTMLElement> | null = null;
let detailEl: JQuery<HTMLElement> | null = null;

function renderRightTab(rightEl: JQuery<HTMLElement>, tab: 'route' | 'vendor' | 'settings'): void {
    rightEl.empty();
    if (tab === 'route') {
        rightEl.append($('<div class="csl-empty">').text('可用 / 路由详情在中间栏。管理功能后续接入：Vendor、设置、导入导出。'));
    } else if (tab === 'vendor') {
        rightEl.append($('<div class="csl-empty">').text('Vendor 管理（开发中）。当前请使用路由面板。'));
    } else {
        const routing = routingSettings();
        const rows = $('<div></div>');
        rows.append(cslField('启用路由', cslCheckbox(routing.enabled, v => { routing.enabled = v; saveSettingsNow(); })));
        rows.append(cslField('保持同一 Vendor（次）', cslNumber(routing.stickyCount, v => { settings().routing.stickyCount = v; saveSettingsNow(); })));
        rows.append(cslField('失败阈值', cslNumber(routing.failThreshold, v => { settings().routing.failThreshold = v; saveSettingsNow(); })));
        rows.append(cslField('冷却时间（秒）', cslNumber(routing.cooldownSeconds, v => { settings().routing.cooldownSeconds = v; saveSettingsNow(); })));
        rightEl.append(rows);
    }
}

function cslField(label: string, control: JQuery<HTMLElement>): JQuery<HTMLElement> {
    return $('<label class="csl-field"></label>').append($('<span class="csl-field-label">').text(label), control);
}

function cslCheckbox(value: boolean, onChange: (v: boolean) => void): JQuery<HTMLElement> {
    return $('<input type="checkbox">').prop('checked', value).on('change', function () { onChange($(this).prop('checked')); });
}

function cslNumber(value: number, onChange: (v: number) => void): JQuery<HTMLElement> {
    return $('<input class="text_pole csl-num" type="number" min="0" step="1">').val(value).on('change', function () { onChange(Number($(this).val()) || 0); });
}

function injectStyles(): void {
    if (document.getElementById('quicker-api-csl-styles')) return;
    $('<style id="quicker-api-csl-styles"></style>').text(`
        .quicker-api__csl-overlay {
            position: fixed; inset: 4vh 4vw; z-index: 99998;
            display: flex; flex-direction: column;
            background: var(--SmartThemeBlurTintColor, rgba(24,24,28,0.94));
            border: 1px solid var(--SmartThemeBorderColor, rgba(128,128,128,0.3));
            border-radius: 14px; box-shadow: 0 12px 48px rgba(0,0,0,.5);
            color: var(--SmartThemeBodyColor, #e8e8e8); font-size: 13px;
            overflow: hidden;
        }
        .csl-head { display:flex; align-items:center; gap:8px; padding:10px 14px; border-bottom:1px solid rgba(128,128,128,.18); }
        .csl-head-title { font-weight:600; font-size:14px; }
        .csl-head-close { margin-left:auto; }
        .csl-body { display:grid; grid-template-columns: 300px minmax(0,1fr) 300px; flex:1; min-height:0; }
        .csl-col { display:flex; flex-direction:column; min-height:0; overflow:hidden; }
        .csl-col--left { border-right:1px solid rgba(128,128,128,.18); }
        .csl-col--mid { border-right:1px solid rgba(128,128,128,.18); }
        .csl-col-head { padding:8px 12px; font-size:12px; color:#999; border-bottom:1px solid rgba(128,128,128,.12); flex:none; }
        .csl-scroll { flex:1; overflow-y:auto; min-height:0; }
        .csl-model-row { padding:8px 12px; cursor:pointer; border-bottom:1px solid rgba(128,128,128,.07); }
        .csl-model-row:hover { background: rgba(255,255,255,.04); }
        .csl-model-row.is-selected { background: rgba(91,155,213,.14); }
        .csl-model-top { display:flex; align-items:center; gap:8px; }
        .csl-model-name { flex:1; min-width:0; font-weight:600; }
        .csl-model-meta { font-size:11px; color:#999; flex:none; }
        .csl-model-sub { display:block; font-size:11px; color:#7cf; margin-top:2px; word-break:break-all; }
        .csl-model-sub--empty { color:#999; }
        .csl-model-flag { display:block; font-size:11px; color:#e0c07e; padding:2px 12px 6px; }
        .csl-dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:6px; }
        .csl-dot--ok { background:#7ecf8a; }
        .csl-dot--warn { background:#e0c07e; }
        .csl-dot--error { background:#e08a8a; }
        .csl-dot--empty { background:#666; }
        .csl-empty { padding:14px; font-size:12px; color:#999; line-height:1.6; }
        .csl-detail-head { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid rgba(128,128,128,.12); }
        .csl-detail-title { font-weight:600; flex:1; }
        .csl-route-list { padding:8px; display:flex; flex-direction:column; gap:6px; }
        .csl-route-row { display:flex; align-items:center; gap:8px; padding:6px 10px; border:1px solid rgba(128,128,128,.2); border-radius:6px; flex-wrap:wrap; }
        .csl-route-name { flex:1; min-width:0; word-break:break-all; }
        .csl-route-state { font-size:12px; }
        .csl-tabs { display:flex; }
        .csl-tab { padding:8px 12px; cursor:pointer; font-size:12px; color:#999; }
        .csl-tab.is-active { color:#7cf; border-bottom:2px solid #7cf; }
        .csl-field { display:flex; align-items:center; gap:8px; padding:6px 12px; }
        .csl-field-label { flex:1; font-size:12px; }
        .csl-num { width:80px; }
        @media (max-width: 900px) {
            .quicker-api__csl-overlay { inset: 6px; }
            .csl-body { grid-template-columns: 1fr; grid-template-rows: auto auto 1fr; overflow-y:auto; }
            .csl-col--mid { border-right:none; }
            .csl-scroll { max-height: none; }
        }
    `).appendTo(document.head);
}

export function toggleConsolePanel(): void {
    if (panelEl && panelEl.is(':visible')) {
        panelEl.remove();
        panelEl = null;
        return;
    }
    injectStyles();
    const overlay = $('<div class="quicker-api__csl-overlay" role="dialog" aria-label="路由控制台"></div>');
    const head = $('<div class="csl-head"></div>');
    head.append($('<span class="csl-head-title"><i class="fa-solid fa-route"></i> 路由控制台</span>'));
    const closeBtn = $('<button class="menu_button csl-head-close" type="button" title="关闭"><i class="fa-solid fa-xmark"></i></button>')
        .on('click', () => { overlay.remove(); panelEl = null; });
    head.append(closeBtn);
    overlay.append(head);

    const body = $('<div class="csl-body"></div>');

    // 左栏
    const left = $('<div class="csl-col csl-col--left"></div>');
    left.append($('<div class="csl-col-head">').text('逻辑模型'));
    const dashboardScroll = $('<div class="csl-scroll"></div>');
    dashboardEl = dashboardScroll;
    const search = $('<input class="text_pole" type="search" maxlength="200" placeholder="搜索模型…" style="margin:8px 12px">');
    search.on('input', function () {
        const q = String($(this).val() || '').trim().toLowerCase();
        dashboardScroll.find('.csl-model-row').each(function () {
            const matches = !q || String($(this).attr('data-search') || '').includes(q);
            $(this).toggle(matches);
        });
    });
    left.append(search, dashboardScroll);

    // 中栏
    const mid = $('<div class="csl-col csl-col--mid"></div>');
    mid.append($('<div class="csl-col-head">').text('路由详情'));
    const detailScroll = $('<div class="csl-scroll"></div>');
    detailEl = detailScroll;
    mid.append(detailScroll);

    // 右栏
    const right = $('<div class="csl-col"></div>');
    const tabs = $('<div class="csl-tabs"></div>');
    const rightBody = $('<div class="csl-scroll"></div>');
    const tabDefs: { key: 'route' | 'vendor' | 'settings'; label: string }[] = [
        { key: 'route', label: '路由' },
        { key: 'vendor', label: 'Vendor' },
        { key: 'settings', label: '设置' },
    ];
    for (const tab of tabDefs) {
        const btn = $('<button class="csl-tab" type="button"></button>').text(tab.label).toggleClass('is-active', rightTab === tab.key);
        btn.on('click', () => { rightTab = tab.key; tabs.find('.csl-tab').removeClass('is-active'); btn.addClass('is-active'); renderRightTab(rightBody, rightTab); });
        tabs.append(btn);
    }
    right.append(tabs, rightBody);

    body.append(left, mid, right);
    overlay.append(body);
    $(document.body).append(overlay);
    panelEl = overlay;

    renderDashboard();
    renderRouteDetail();
    renderRightTab(rightBody, rightTab);

    // 关闭：点击外部 / Esc
    const closeHandler = (e: JQuery.Event) => {
        if (e.key === 'Escape') { overlay.remove(); panelEl = null; }
    };
    $(document).on('keydown.quickerApiCsl', closeHandler);
    overlay.on('remove', () => $(document).off('keydown.quickerApiCsl'));
}

/** 供入口按钮调用：打开或关闭控制台。 */
export function openConsolePanel(): void {
    toggleConsolePanel();
}
