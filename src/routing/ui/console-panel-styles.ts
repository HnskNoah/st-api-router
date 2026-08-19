// 三栏控制台面板的 CSS 注入（纯样式，无逻辑）。
// 拆分自 console-panel.ts，保持编排器 < 500 行。

export function ensureConsolePanelStyles(): void {
    if (document.getElementById('quicker-api-console-panel-styles')) return;
    $('<style id="quicker-api-console-panel-styles"></style>').text(`
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
            background: var(--panel-bg, #1a1d23);
            border: 1px solid rgba(128, 128, 128, 0.3);
            border-radius: 12px;
            width: min(1200px, 92vw); height: min(750px, 85vh);
            display: flex; flex-direction: column;
            box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
            overflow: hidden;
        }

        /* ── 标题栏 ── */
        .csl-header {
            display: flex; align-items: center; gap: 8px;
            padding: 10px 16px;
            border-bottom: 1px solid rgba(128, 128, 128, 0.2);
            flex-shrink: 0;
        }
        .csl-header-title {
            font-weight: 600; font-size: 14px; flex: 1;
        }
        .csl-header-title > i { margin-right: 6px; color: #5b9bd5; }
        .csl-header-close {
            flex: none; cursor: pointer; font-size: 18px;
            width: 28px; height: 28px; display: flex;
            align-items: center; justify-content: center;
            border-radius: 6px; color: #999;
            transition: background 0.12s, color 0.12s;
        }
        .csl-header-close:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }

        /* ── 三栏体 ── */
        .csl-body { display: flex; flex: 1; min-height: 0; }

        /* ── 左栏：仪表盘 ── */
        .csl-left {
            width: 260px; flex-shrink: 0;
            border-right: 1px solid rgba(128, 128, 128, 0.15);
            display: flex; flex-direction: column; overflow: hidden;
        }
        .csl-left-search {
            flex-shrink: 0; padding: 8px 10px;
            border-bottom: 1px solid rgba(128, 128, 128, 0.1);
        }
        .csl-left-search > input { width: 100%; margin: 0; box-sizing: border-box; }
        .csl-left-list { flex: 1; overflow-y: auto; padding: 4px 0; }

        /* ── 左栏模型行 ── */
        .csl-model-row {
            display: flex; flex-direction: column; gap: 1px;
            padding: 8px 12px; cursor: pointer;
            border-left: 3px solid transparent;
            transition: background 0.1s, border-color 0.1s;
        }
        .csl-model-row:hover { background: rgba(255, 255, 255, 0.04); }
        .csl-model-row.is-selected {
            background: rgba(91, 155, 213, 0.12);
            border-left-color: #5b9bd5;
        }
        .csl-model-row.is-current .csl-model-name {
            color: #5b9bd5;
        }
        .csl-model-row.is-current .csl-model-meta::after {
            content: '当前';
            margin-left: 4px; font-size: 10px; color: #5b9bd5;
            border: 1px solid rgba(91,155,213,.5); border-radius: 8px; padding: 0 4px;
        }
        .csl-model-top { display: flex; align-items: center; gap: 6px; }
        .csl-model-name { font-weight: 600; font-size: 13px; flex: 1; min-width: 0; }
        .csl-model-name > span { vertical-align: middle; }
        .csl-model-meta { font-size: 11px; color: #999; flex: none; white-space: nowrap; }
        .csl-model-sub { font-size: 11px; color: #777; padding-left: 2px; }
        .csl-model-sub--empty { font-style: italic; }
        .csl-model-flag { font-size: 11px; color: #e0c07e; padding: 2px 12px 6px; }

        /* ── 中栏：路由详情 ── */
        .csl-center {
            flex: 1; min-width: 0;
            display: flex; flex-direction: column; overflow: hidden;
        }
        .csl-detail-head {
            display: flex; align-items: center; gap: 8px;
            padding: 10px 14px;
            border-bottom: 1px solid rgba(128, 128, 128, 0.1);
            flex-shrink: 0;
        }
        .csl-detail-title { font-weight: 600; font-size: 14px; flex: 1; }
        .csl-route-list { flex: 1; overflow-y: auto; padding: 6px 10px; }
        .csl-route-row {
            display: flex; align-items: center; gap: 8px;
            padding: 8px 10px; border-radius: 6px;
            transition: background 0.1s;
        }
        .csl-route-row:hover { background: rgba(255, 255, 255, 0.04); }
        .csl-route-name { flex: 1; font-size: 13px; min-width: 0; }
        .csl-route-state { font-size: 12px; color: #999; flex: none; }

        /* ── 右栏 ── */
        .csl-right {
            width: 320px; flex-shrink: 0;
            border-left: 1px solid rgba(128, 128, 128, 0.15);
            display: flex; flex-direction: column; overflow: hidden;
        }
        .csl-right-tabs {
            display: flex; flex-shrink: 0;
            border-bottom: 1px solid rgba(128, 128, 128, 0.15);
        }
        .csl-right-tab {
            flex: 1; text-align: center; padding: 8px 4px;
            font-size: 12px; cursor: pointer; color: #999;
            border-bottom: 2px solid transparent;
            transition: color 0.12s, border-color 0.12s;
            user-select: none;
        }
        .csl-right-tab:hover { color: #ccc; }
        .csl-right-tab.is-active { color: #fff; border-bottom-color: #5b9bd5; }
        .csl-right-content { flex: 1; overflow-y: auto; padding: 10px; }

        /* ── 共用控件 ── */
        .csl-empty {
            font-size: 12px; color: #999; padding: 16px 10px; line-height: 1.6;
        }
        .csl-field {
            display: flex; align-items: center; gap: 6px;
            padding: 6px 0; font-size: 13px;
        }
        .csl-field-label { flex: none; font-size: 12px; color: #ccc; min-width: 80px; }
        .csl-field > select.text_pole, .csl-field > input.text_pole:not([type="checkbox"]) {
            margin: 0; flex: 1; min-width: 0;
        }
        .csl-field > input[type="checkbox"] { flex: none; }
        .csl-num { width: 60px; }
        .csl-settings-group { display: flex; flex-direction: column; gap: 2px; }
        .csl-section-title {
            font-size: 12px; font-weight: 600; color: #999;
            padding: 8px 0 4px; border-bottom: 1px solid rgba(128, 128, 128, 0.1);
            margin-bottom: 4px;
        }

        /* ── 圆点指示器 ── */
        .csl-dot {
            display: inline-block; width: 8px; height: 8px; border-radius: 50%;
            flex: none; vertical-align: middle; margin-right: 4px;
        }
        .csl-dot--ok { background: #7ecf8a; }
        .csl-dot--warn { background: #e0c07e; }
        .csl-dot--error { background: #e08a8a; }
        .csl-dot--empty { background: #555; }

        /* ── Vendor 列表（右栏） ── */
        .csl-vendor-row {
            border: 1px solid rgba(128, 128, 128, 0.18);
            border-radius: 8px; margin-bottom: 6px; overflow: hidden;
        }
        .csl-vendor-row--unused { opacity: 0.5; }
        .csl-vendor-head {
            display: flex; align-items: center; gap: 6px;
            padding: 8px 10px; flex-wrap: wrap;
        }
        .csl-vendor-expand {
            flex: none; cursor: pointer; font-size: 11px; color: #5b9bd5;
            transition: transform 0.15s; padding: 2px;
        }
        .csl-vendor-expand--open { transform: rotate(90deg); }
        .csl-vendor-name { font-weight: 600; font-size: 13px; flex: 1; min-width: 0; }
        .csl-vendor-badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; border: 1px solid; flex: none; }
        .csl-vendor-badge--ok { color: #7ecf8a; border-color: rgba(126, 207, 138, 0.5); }
        .csl-vendor-badge--disabled { color: #e08a8a; border-color: rgba(224, 138, 138, 0.5); }
        .csl-vendor-badge--rpm { color: #e0c07e; border-color: rgba(224, 192, 126, 0.5); }
        .csl-vendor-meta { font-size: 11px; color: #999; flex: none; }
        .csl-vendor-rate-bar { display: inline-flex; width: 40px; height: 8px; border-radius: 4px; background: rgba(255,255,255,0.1); overflow: hidden; vertical-align: middle; margin: 0 4px; }
        .csl-vendor-rate-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
        .csl-vendor-actions { flex: none; display: flex; gap: 4px; }
        .csl-vendor-keys { padding: 2px 10px 10px 34px; }
        .csl-vendor-key-row {
            display: flex; align-items: center; gap: 6px; padding: 4px 0; flex-wrap: wrap;
        }
        .csl-vendor-key-row--unused { opacity: 0.45; }
        .csl-vendor-key-label { font-size: 12px; font-weight: 500; flex: none; min-width: 40px; }
        .csl-vendor-key-row > input[type="password"] { flex: 1; min-width: 100px; margin: 0; }
        .csl-vendor-add-wrap { padding: 8px 0; }
        .csl-vendor-health { display: flex; flex-wrap: wrap; gap: 4px; flex-basis: 100%; padding: 2px 0; }
        .csl-health-pill {
            display: inline-flex; align-items: center; gap: 4px;
            font-size: 10px; padding: 1px 6px; border-radius: 8px;
            border: 1px solid rgba(128, 128, 128, 0.3);
        }
        /* 正常模型淡化，冷却/异常高亮 */
        .csl-health--muted { opacity: 0.45; }
        .csl-health--muted .csl-health-pill-state,
        .csl-health--muted .csl-health-reset { display: none; }
        .csl-health--healthy { border-color: rgba(126, 207, 138, 0.5); color: #7ecf8a; }
        .csl-health--cooldown { border-color: rgba(224, 192, 126, 0.5); color: #e0c07e; background: rgba(224,192,126,0.1); }
        .csl-health--fatal { border-color: rgba(224, 138, 138, 0.5); color: #e08a8a; background: rgba(224,138,138,0.12); }
        .csl-health-pill-model { min-width: 0; }
        .csl-health-pill-state { font-weight: 600; }
        .csl-health-reset { cursor: pointer; opacity: 0.6; font-size: 10px; }
        .csl-health-reset:hover { opacity: 1; color: #fff; }

        /* ── 编辑弹窗内 ── */
        .csl-editor { max-height: 65vh; overflow-y: auto; padding-right: 4px; }
        .csl-entry-list { display: flex; flex-direction: column; gap: 4px; flex-basis: 100%; }
        .csl-entry-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .csl-entry-row > select.text_pole { width: auto; max-width: 140px; margin: 0; }
        .csl-entry-row > input[type="password"] { flex: 1; min-width: 80px; margin: 0; }

        /* ── 映射 tab ── */
        .csl-mapping-topbar { margin-bottom: 10px; }
        .csl-mapping-section { margin-bottom: 14px; }
        .csl-mapping-section-title { font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #ccc; }
        .csl-mapping-rules { display: flex; flex-direction: column; gap: 6px; }
        .csl-mapping-rule-row {
            display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
            border: 1px solid rgba(128,128,128,0.22); border-radius: 6px;
            padding: 6px 10px; background: rgba(0,0,0,0.08);
        }
        .csl-mapping-rule-row > code {
            font-family: monospace; font-size: 12px; word-break: break-all;
            background: rgba(255,255,255,0.06); border-radius: 4px; padding: 1px 6px;
        }
        .csl-mapping-rule-target { font-size: 12px; color: #9cf; flex: none; }
        .csl-mapping-rule-actions { margin-left: auto; display: flex; gap: 4px; flex: none; }
        .csl-mapping-empty { font-size: 12px; color: #999; padding: 4px 2px; }
        .csl-mapping-ignored-label { font-size: 12px; color: #999; margin: 6px 0 4px; }
        .csl-mapping-ignored-pills { display: flex; flex-wrap: wrap; gap: 5px; }
        .csl-mapping-ignore-pill {
            display: inline-flex; align-items: center; gap: 5px;
            font-size: 11px; padding: 2px 8px; border-radius: 10px;
            border: 1px solid rgba(128,128,128,0.3); background: rgba(0,0,0,0.08);
        }
        .csl-mapping-ignore-pill--auto { border-style: dashed; color: #999; }
        .csl-mapping-unignore { cursor: pointer; opacity: 0.6; }
        .csl-mapping-unignore:hover { opacity: 1; color: #fff; }
        .csl-mapping-preview { font-size: 12px; color: #999; padding: 4px 0; }
        .csl-mapping-hint { font-size: 11px; color: #888; margin-top: 8px; }

        /* ── 路由详情：最近失败记录 ── */
        .csl-route-failures { margin-top: 12px; border-top: 1px solid rgba(128,128,128,0.2); padding-top: 8px; }
        .csl-route-failures-head { font-size: 12px; color: #999; font-weight: 600; margin-bottom: 6px; }
        .csl-route-failure-row { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 3px 0; flex-wrap: wrap; }
        .csl-route-failure-unit { color: #ccc; flex: none; }
        .csl-route-failure-kind { flex: none; font-size: 10px; padding: 1px 6px; border-radius: 8px; border: 1px solid rgba(224,138,138,0.5); color: #e08a8a; }
        .csl-route-failure-msg { color: #999; word-break: break-all; min-width: 0; }
        .csl-route-failure-empty { font-size: 12px; color: #999; padding: 4px 0; }

        /* ── 路由 tab：分组切换 ── */
        .csl-route-group-section { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
        .csl-route-group-label { font-size: 12px; color: #999; flex: none; }
    `).appendTo(document.head);
}