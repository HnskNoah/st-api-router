// 路由控制台 CSS 注入（纯样式，无逻辑）。
// v2 设计系统：自包含深色卡片令牌 + 三级按钮体系，不依赖 ST 主题变量。
// 令牌挂在 .csl-overlay / .qam-overlay 根上；组件类名保持稳定，渲染器只换按钮类。

export function ensureConsolePanelStyles(): void {
    if (document.getElementById('quicker-api-console-panel-styles')) return;
    $('<style id="quicker-api-console-panel-styles"></style>').text(`
        /* ── 设计令牌 ── */
        .csl-overlay, .qam-overlay {
            --csl-bg: #16181d;
            --csl-card: #1e2128;
            --csl-card-hover: #23262e;
            --csl-border: rgba(255, 255, 255, 0.06);
            --csl-border-strong: rgba(255, 255, 255, 0.12);
            --csl-text: #e8eaee;
            --csl-text-dim: #9aa0aa;
            --csl-text-faint: #6b7078;
            --csl-accent: #5b9bd5;
            --csl-ok: #7ecf8a;
            --csl-warn: #e0c07e;
            --csl-danger: #e08a8a;
            --csl-radius: 10px;
        }

        /* ── 三级按钮体系 ── */
        .csl-btn {
            display: inline-flex; align-items: center; justify-content: center; gap: 6px;
            padding: 5px 10px; border-radius: 7px;
            font-size: 12px; line-height: 1.4;
            background: transparent; border: 1px solid transparent;
            color: var(--csl-text);
            cursor: pointer; user-select: none; white-space: nowrap;
            transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;
        }
        .csl-btn:focus-visible { outline: 2px solid var(--csl-accent); outline-offset: 1px; }
        .csl-btn[disabled] { opacity: 0.45; pointer-events: none; }
        .csl-btn.is-loading i, .csl-btn.is-loading .fa-solid { animation: csl-spin 0.8s linear infinite; }
        @keyframes csl-spin { to { transform: rotate(360deg); } }

        .csl-btn--primary { background: var(--csl-accent); border-color: var(--csl-accent); color: #fff; font-weight: 600; }
        .csl-btn--primary:hover { filter: brightness(1.1); }

        .csl-btn--secondary { background: var(--csl-card); border-color: var(--csl-border-strong); }
        .csl-btn--secondary:hover { background: var(--csl-card-hover); border-color: var(--csl-accent); }

        .csl-btn--icon { padding: 4px 7px; color: var(--csl-text-dim); }
        .csl-btn--icon:hover { background: var(--csl-card-hover); color: var(--csl-text); }

        .csl-btn--danger { color: var(--csl-danger); border-color: rgba(224, 138, 138, 0.35); background: transparent; }
        .csl-btn--danger:hover { background: var(--csl-danger); border-color: var(--csl-danger); color: #fff; }
        .csl-btn--danger.csl-btn--icon { border-color: transparent; }
        .csl-btn--danger.csl-btn--icon:hover { background: rgba(224, 138, 138, 0.14); color: var(--csl-danger); }

        /* ── 浮层遮罩 ── */
        .csl-overlay {
            position: fixed; inset: 0; z-index: 9999;
            background: rgba(0, 0, 0, 0.55);
            display: flex; align-items: center; justify-content: center;
            opacity: 0; transition: opacity 0.15s ease;
        }
        .csl-overlay--open { opacity: 1; }

        /* ── 面板容器 ── */
        .csl-panel {
            background: var(--csl-bg);
            border: 1px solid var(--csl-border-strong);
            border-radius: var(--csl-radius);
            width: min(1200px, 92vw); height: min(750px, 85vh);
            display: flex; flex-direction: column;
            box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
            overflow: hidden;
        }

        /* ── 标题栏 ── */
        .csl-header {
            display: flex; align-items: center; gap: 8px;
            padding: 10px 16px;
            border-bottom: 1px solid var(--csl-border);
            flex-shrink: 0;
        }
        .csl-header-title { font-weight: 600; font-size: 14px; flex: 1; color: var(--csl-text); }
        .csl-header-title > i { margin-right: 6px; color: var(--csl-accent); }
        .csl-header-close {
            flex: none; cursor: pointer; font-size: 18px;
            width: 28px; height: 28px; display: flex;
            align-items: center; justify-content: center;
            border-radius: 6px; color: var(--csl-text-faint);
            transition: background 0.12s, color 0.12s;
        }
        .csl-header-close:hover { background: var(--csl-card-hover); color: var(--csl-text); }

        /* ── 三栏体 ── */
        .csl-body { display: flex; flex: 1; min-height: 0; }

        /* ── 左栏：仪表盘 ── */
        .csl-left {
            width: 260px; flex: 0 0 260px;
            border-right: 1px solid var(--csl-border);
            display: flex; flex-direction: column; overflow: hidden;
        }
        .csl-left-search {
            flex-shrink: 0; padding: 8px 10px;
            border-bottom: 1px solid var(--csl-border);
        }
        .csl-left-search > input { width: 100%; margin: 0; box-sizing: border-box; }
        .csl-left-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 0; visibility: visible; }

        /* ── 左栏模型行 ── */
        .csl-model-row {
            display: flex !important; flex-direction: column; gap: 1px;
            min-height: 42px; box-sizing: border-box;
            padding: 8px 12px; cursor: pointer; visibility: visible; opacity: 1;
            border-left: 3px solid transparent;
            transition: background 0.12s ease, border-color 0.12s ease;
        }
        .csl-model-row:hover { background: var(--csl-card-hover); }
        .csl-model-row.is-selected { background: rgba(91, 155, 213, 0.12); border-left-color: var(--csl-accent); }
        .csl-model-row.is-current .csl-model-name { color: var(--csl-accent); }
        .csl-model-row.is-current .csl-model-meta::after {
            content: '当前';
            margin-left: 4px; font-size: 10px; color: var(--csl-accent);
            border: 1px solid rgba(91,155,213,.5); border-radius: 8px; padding: 0 4px;
        }
        .csl-model-top { display: flex; align-items: center; gap: 6px; }
        .csl-model-name { display: flex; align-items: center; gap: 4px; min-width: 0; color: var(--csl-text); font-weight: 600; font-size: 13px; flex: 1; }
        .csl-model-name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .csl-model-name > span { vertical-align: middle; }
        .csl-model-meta { font-size: 11px; color: var(--csl-text-dim); flex: none; white-space: nowrap; }
        .csl-model-top > .csl-model-params {
            flex: none; cursor: pointer; font-size: 11px; padding: 0 2px;
            background: transparent; border: none; color: var(--csl-text-dim);
            transition: color 0.12s, transform 0.12s;
        }
        .csl-model-top > .csl-model-params:hover { color: var(--csl-text); transform: scale(1.1); }
        .csl-model-sub { font-size: 11px; color: var(--csl-text-faint); padding-left: 2px; }
        .csl-model-sub--empty { font-style: italic; }
        .csl-model-flag { font-size: 11px; color: var(--csl-warn); padding: 2px 12px 6px; }

        /* ── 中栏：路由详情 ── */
        .csl-center { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
        .csl-detail-head {
            display: flex; align-items: center; gap: 8px;
            padding: 10px 14px;
            border-bottom: 1px solid var(--csl-border);
            flex-shrink: 0;
        }
        .csl-detail-title { font-weight: 600; font-size: 14px; flex: 1; color: var(--csl-text); }
        .csl-route-list { flex: 1; overflow-y: auto; padding: 6px 10px; }
        .csl-route-row {
            display: flex; align-items: center; gap: 8px;
            padding: 8px 10px; border-radius: 6px;
            transition: background 0.12s ease;
        }
        .csl-route-row:hover { background: var(--csl-card-hover); }
        .csl-route-name { flex: 1; font-size: 13px; min-width: 0; color: var(--csl-text); }
        .csl-route-weights { font-size: 11px; color: var(--csl-text-dim); flex: none; white-space: nowrap; }
        .csl-route-weight, .csl-vendor-key-weight { width: 62px; flex: none; margin: 0; }
        .csl-route-state { font-size: 12px; color: var(--csl-text-dim); flex: none; }

        /* ── 右栏 ── */
        .csl-right {
            width: 320px; flex-shrink: 0;
            border-left: 1px solid var(--csl-border);
            display: flex; flex-direction: column; overflow: hidden;
        }
        .csl-right-tabs {
            display: flex; flex-shrink: 0;
            border-bottom: 1px solid var(--csl-border);
        }
        .csl-right-tab {
            flex: 1; text-align: center; padding: 8px 4px;
            font-size: 12px; cursor: pointer; color: var(--csl-text-dim);
            border-bottom: 2px solid transparent;
            transition: color 0.12s, border-color 0.12s;
            user-select: none;
        }
        .csl-right-tab:hover { color: var(--csl-text); }
        .csl-right-tab.is-active { color: var(--csl-text); border-bottom-color: var(--csl-accent); }
        .csl-right-content { flex: 1; overflow-y: auto; padding: 10px; }

        /* ── 共用控件 ── */
        .csl-empty { font-size: 12px; color: var(--csl-text-dim); padding: 16px 10px; line-height: 1.6; }
        .csl-field { display: flex; align-items: center; gap: 6px; padding: 6px 0; font-size: 13px; }
        .csl-field-label { flex: none; font-size: 12px; color: var(--csl-text-dim); min-width: 80px; }
        .quicker-api__field-hint {
            display: inline-flex; align-items: center; justify-content: center;
            width: 14px; height: 14px; margin-left: 3px;
            font-size: 10px; border-radius: 50%;
            border: 1px solid var(--csl-border-strong); color: var(--csl-text-faint);
            cursor: help;
        }
        .csl-field > select.text_pole, .csl-field > input.text_pole:not([type="checkbox"]) { margin: 0; flex: 1; min-width: 0; }
        .csl-field > input[type="checkbox"] { flex: none; }
        .csl-num { width: 60px; }
        .csl-settings-group { display: flex; flex-direction: column; gap: 2px; }
        .csl-settings-block + .csl-settings-block { border-top: 1px solid var(--csl-border); padding-top: 8px; margin-top: 8px; }
        .csl-section-title {
            font-size: 12px; font-weight: 600; color: var(--csl-text-dim);
            padding: 8px 0 4px; border-bottom: 1px solid var(--csl-border);
            margin-bottom: 4px;
        }

        /* ── 圆点指示器 ── */
        .csl-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex: none; vertical-align: middle; margin-right: 4px; }
        .csl-dot--ok { background: var(--csl-ok); }
        .csl-dot--warn { background: var(--csl-warn); }
        .csl-dot--error { background: var(--csl-danger); }
        .csl-dot--empty { background: var(--csl-text-faint); }

        /* ── Vendor 列表（右栏） ── */
        .csl-vendor-row {
            border: 1px solid var(--csl-border-strong);
            border-radius: 8px; margin-bottom: 6px; overflow: hidden;
            background: var(--csl-card);
        }
        .csl-vendor-row--unused { opacity: 0.5; }
        .csl-vendor-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; flex-wrap: wrap; }
        .csl-vendor-expand {
            flex: none; cursor: pointer; font-size: 11px; color: var(--csl-accent);
            transition: transform 0.15s; padding: 2px;
        }
        .csl-vendor-expand--open { transform: rotate(90deg); }
        .csl-vendor-name { font-weight: 600; font-size: 13px; flex: 1; min-width: 0; color: var(--csl-text); }
        .csl-vendor-badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; border: 1px solid; flex: none; }
        .csl-vendor-badge--ok { color: var(--csl-ok); border-color: rgba(126, 207, 138, 0.5); }
        .csl-vendor-badge--disabled { color: var(--csl-danger); border-color: rgba(224, 138, 138, 0.5); }
        .csl-vendor-badge--rpm { color: var(--csl-warn); border-color: rgba(224, 192, 126, 0.5); }
        .csl-vendor-meta { font-size: 11px; color: var(--csl-text-dim); flex: none; }
        .csl-vendor-subrow {
            display: flex; align-items: center; gap: 6px;
            padding: 0 10px 6px 34px; font-size: 11px; color: var(--csl-text-dim);
            flex-wrap: wrap; min-width: 0;
        }
        .csl-vendor-subrow .csl-vendor-meta { display: inline-flex; align-items: center; }
        .csl-vendor-rate-bar { display: inline-flex; width: 40px; height: 8px; border-radius: 4px; background: rgba(255,255,255,0.08); overflow: hidden; vertical-align: middle; margin: 0 4px; }
        .csl-vendor-rate-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
        .csl-vendor-actions { flex: none; display: flex; gap: 4px; }
        .csl-vendor-keys { padding: 2px 10px 10px 34px; }
        .csl-vendor-key-row { display: flex; align-items: center; gap: 6px; padding: 4px 0; flex-wrap: wrap; }
        .csl-vendor-key-row--unused { opacity: 0.45; }
        .csl-vendor-key-label { font-size: 12px; font-weight: 500; flex: none; min-width: 40px; }
        .csl-vendor-key-row > input[type="password"] { flex: 1; min-width: 100px; margin: 0; }
        .csl-vendor-add-wrap { padding: 8px 0; }
        .csl-vendor-health { display: flex; flex-wrap: wrap; gap: 4px; flex-basis: 100%; padding: 2px 0; align-items: center; }
        .csl-health-pill {
            display: inline-flex; align-items: center; gap: 4px;
            font-size: 10px; padding: 1px 6px; border-radius: 8px;
            border: 1px solid var(--csl-border-strong);
        }
        /* 正常模型淡化，冷却/异常高亮 */
        .csl-health--muted { opacity: 0.45; }
        .csl-health--muted .csl-health-pill-state,
        .csl-health--muted .csl-health-reset { display: none; }
        .csl-health--healthy { border-color: rgba(126, 207, 138, 0.5); color: var(--csl-ok); }
        .csl-health--cooldown { border-color: rgba(224, 192, 126, 0.5); color: var(--csl-warn); background: rgba(224,192,126,0.1); }
        .csl-health--fatal { border-color: rgba(224, 138, 138, 0.5); color: var(--csl-danger); background: rgba(224,138,138,0.12); }
        .csl-health-pill-model { min-width: 0; }
        .csl-health-pill-state { font-weight: 600; }
        .csl-health-reset { cursor: pointer; opacity: 0.6; font-size: 10px; }
        .csl-health-reset:hover { opacity: 1; color: var(--csl-text); }
        .csl-health-normal { display: inline-flex; align-items: center; gap: 2px; flex-wrap: wrap; }
        .csl-health-normal-toggle {
            cursor: pointer; font-size: 10px; color: var(--csl-text-dim);
            border: 1px solid var(--csl-border-strong); border-radius: 8px;
            padding: 1px 6px; user-select: none;
            transition: color 0.12s, border-color 0.12s;
        }
        .csl-health-normal-toggle:hover { color: var(--csl-text); border-color: var(--csl-accent); }
        .csl-health-normal-pool { display: inline-flex; flex-wrap: wrap; gap: 4px; }

        /* ── 编辑弹窗内 ── */
        .csl-editor { max-height: 65vh; overflow-y: auto; padding-right: 4px; }
        .csl-entry-list { display: flex; flex-direction: column; gap: 4px; flex-basis: 100%; }
        .csl-entry-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .csl-entry-row > select.text_pole { width: auto; max-width: 140px; margin: 0; }
        .csl-entry-row > input[type="password"] { flex: 1; min-width: 80px; margin: 0; }

        /* ── 映射 tab ── */
        .csl-mapping-topbar { margin-bottom: 10px; }
        .csl-mapping-section { margin-bottom: 14px; }
        .csl-mapping-section-title { font-weight: 600; font-size: 13px; margin-bottom: 6px; color: var(--csl-text-dim); }
        .csl-mapping-rules, .csl-mapping-unmapped { display: flex; flex-direction: column; gap: 6px; }
        .csl-mapping-unmapped-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .csl-mapping-unmapped-row > code { flex: 1; min-width: 0; font-size: 12px; overflow-wrap: anywhere; }
        .csl-mapping-unmapped-row > select.text_pole { flex: 1; min-width: 120px; margin: 0; }
        .csl-mapping-rule-row {
            border: 1px solid var(--csl-border-strong); border-radius: 6px;
            padding: 6px 10px; background: rgba(0,0,0,0.14);
        }
        .csl-mapping-rule-row > code {
            font-family: monospace; font-size: 12px; word-break: break-all;
            background: rgba(255,255,255,0.05); border-radius: 4px; padding: 1px 6px;
        }
        .csl-mapping-rule-target { font-size: 12px; color: var(--csl-accent); flex: none; }
        .csl-mapping-rule-actions { margin-left: auto; display: flex; gap: 4px; flex: none; }
        .csl-mapping-empty { font-size: 12px; color: var(--csl-text-dim); padding: 4px 2px; }
        .csl-mapping-ignore-pill {
            display: inline-flex; align-items: center; gap: 5px;
            font-size: 11px; padding: 2px 8px; border-radius: 10px;
            border: 1px solid var(--csl-border-strong); background: rgba(0,0,0,0.14);
        }
        .csl-mapping-ignore-pill--auto { border-style: dashed; color: var(--csl-text-dim); }
        .csl-mapping-unignore { cursor: pointer; opacity: 0.6; }
        .csl-mapping-unignore:hover { opacity: 1; color: var(--csl-text); }
        .csl-mapping-preview { font-size: 12px; color: var(--csl-text-dim); padding: 4px 0; }
        .csl-mapping-hint { font-size: 11px; color: var(--csl-text-faint); margin-top: 8px; }

        /* ── 路由详情：最近失败记录 ── */
        .csl-route-failures { margin-top: 12px; border-top: 1px solid var(--csl-border-strong); padding-top: 8px; }
        .csl-route-failures-head { font-size: 12px; color: var(--csl-text-dim); font-weight: 600; margin-bottom: 6px; }
        .csl-route-failure-row { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 3px 0; flex-wrap: wrap; }
        .csl-route-failure-time { flex: none; font-size: 10px; color: var(--csl-text-faint); font-variant-numeric: tabular-nums; }
        .csl-route-failure-unit { color: var(--csl-text-dim); flex: none; }
        .csl-route-failure-kind { flex: none; font-size: 10px; padding: 1px 6px; border-radius: 8px; border: 1px solid rgba(224,138,138,0.5); color: var(--csl-danger); }
        .csl-route-failure-msg { color: var(--csl-text-dim); word-break: break-all; min-width: 0; }
        .csl-route-failure-empty { font-size: 12px; color: var(--csl-text-dim); padding: 4px 0; }

        /* ── 路由 tab：分组切换 ── */
        .csl-route-group-section { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
        .csl-route-group-label { font-size: 12px; color: var(--csl-text-dim); flex: none; }
    `).appendTo(document.head);

    // 移动端 Sheet：复用同一套令牌与组件类（qam 容器也声明令牌根）
    if (document.getElementById('quicker-api-mobile-styles')) return;
    $('<style id="quicker-api-mobile-styles"></style>').text(`
        .qam-overlay {
            position: fixed; inset: 0; z-index: 9998;
            background: rgba(0,0,0,0.4);
            visibility: hidden; opacity: 0;
            transition: opacity 0.18s ease, visibility 0.18s;
        }
        .qam-overlay.open { visibility: visible; opacity: 1; }
        .qam-sheet {
            position: fixed; left: 0; right: 0; bottom: 0; z-index: 9999;
            max-height: 90vh; display: flex; flex-direction: column;
            background: var(--csl-bg, #16181d);
            border-top: 1px solid var(--csl-border-strong, rgba(255,255,255,0.12));
            border-radius: 14px 14px 0 0;
            transform: translateY(102%);
            transition: transform 0.22s ease;
            box-shadow: 0 -8px 32px rgba(0,0,0,0.5);
            overflow: hidden;
        }
        .qam-sheet.open { transform: translateY(0); }
        .qam-handle { flex: none; padding: 8px 0 4px; text-align: center; cursor: pointer; }
        .qam-handle::before {
            content: ''; display: inline-block; width: 44px; height: 4px;
            border-radius: 2px; background: rgba(255,255,255,0.18);
        }
        .qam-head {
            display: flex; align-items: center; gap: 8px;
            padding: 6px 12px 8px; border-bottom: 1px solid var(--csl-border, rgba(255,255,255,0.06));
            flex: none;
        }
        .qam-current {
            flex: 1; min-width: 0; font-weight: 600; font-size: 14px;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            color: var(--csl-text, #e8eaee);
        }
        .qam-close { flex: none; cursor: pointer; font-size: 16px; color: var(--csl-text-dim, #9aa0aa); padding: 4px; }
        .qam-body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 0; }
        .qam-manage-pane { padding: 4px 10px 12px; }
        .qam-tabs { flex: none; display: flex; border-top: 1px solid var(--csl-border, rgba(255,255,255,0.06)); }
        .qam-tab {
            flex: 1; text-align: center; padding: 8px 2px; font-size: 12px;
            cursor: pointer; color: var(--csl-text-dim, #9aa0aa); border-top: 2px solid transparent;
        }
        .qam-tab.active { color: var(--csl-text, #e8eaee); border-top-color: var(--csl-accent, #5b9bd5); }
        .qam-manage-tabs { display: flex; border-bottom: 1px solid var(--csl-border, rgba(255,255,255,0.06)); }
        .qam-manage-tab { flex: 1; text-align: center; padding: 6px 2px; font-size: 11px; cursor: pointer; color: var(--csl-text-dim, #9aa0aa); }
        .qam-manage-tab.active { color: var(--csl-accent, #5b9bd5); }
        .qam-empty { font-size: 12px; color: var(--csl-text-dim, #9aa0aa); padding: 16px 10px; }
        .qam-search { padding: 6px 10px; flex: none; }
        .qam-search > input { width: 100%; margin: 0; box-sizing: border-box; }
    `).appendTo(document.head);
}

/** 按钮加载态：异步操作期间禁点并旋转图标。 */
export function setBtnLoading(btn: JQuery<HTMLElement>, loading: boolean): void {
    btn.prop('disabled', loading).toggleClass('is-loading', loading);
}
