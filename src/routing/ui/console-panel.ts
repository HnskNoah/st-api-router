// 三栏控制台面板编排器。
// 导出 openConsolePanel() 供 ui.ts / manual-route-entry.ts 调用。
// 整合左栏（dashboard.ts）、中栏（route-detail.ts）、右栏（right-*.ts）渲染。
// CSS 在独立模块 console-panel-styles.ts 中注入。

import { debugLog } from '../../debug.js';
import { logicalModels } from '../../settings/access.js';
import { renderDashboard } from './dashboard.js';
import { renderRouteDetail } from './route-detail.js';
import { renderRightVendor } from './right-vendor.js';
import { renderRightRoute } from './right-route.js';
import { renderRightMapping } from './right-mapping.js';
import { ensureConsolePanelStyles } from './console-panel-styles.js';
import { isMobileViewport, openConsolePanelMobile } from './console-panel-mobile.js';
import { MODEL_OBSERVATION_RECORDED_EVENT } from '../../domain/model-health.js';

// ── 状态 ──

let overlayEl: JQuery<HTMLElement> | null = null;
let isOpen = false;
let selectedLogicalId: string | null = null;
let rightTab: 'settings' | 'vendor' = 'settings';
let observationListener: (() => void) | null = null;

// ── 面板 DOM 创建 ──

function ensurePanel(): JQuery<HTMLElement> {
    if (overlayEl && overlayEl.parent().length) return overlayEl;

    ensureConsolePanelStyles();

    const overlay = $('<div class="csl-overlay"></div>');
    const panel = $('<div class="csl-panel"></div>');

    // 标题栏
    const header = $('<div class="csl-header"></div>');
    header.append(
        $('<span class="csl-header-title"><i class="fa-solid fa-table-columns"></i>路由控制台</span>'),
        $('<span class="csl-header-close" title="关闭"><i class="fa-solid fa-xmark"></i></span>').on('click', () => closeConsolePanel()),
    );
    panel.append(header);

    // 三栏体
    const body = $('<div class="csl-body"></div>');

    // 左栏：仪表盘
    const left = $('<div class="csl-left"></div>');
    const searchWrap = $('<div class="csl-left-search"></div>');
    searchWrap.append($('<input class="text_pole" type="text" placeholder="搜索模型...">').on('input', () => filterDashboard()));
    left.append(searchWrap, $('<div class="csl-left-list"></div>'));
    body.append(left);

    // 中栏：路由详情
    const center = $('<div class="csl-center"></div>');
    center.append(
        $('<div class="csl-detail-head"></div>').append($('<span class="csl-detail-title">').text('路由详情')),
        $('<div class="csl-route-list"></div>'),
    );
    body.append(center);

    // 右栏：tab 页
    const right = $('<div class="csl-right"></div>');
    const rightTabs = $('<div class="csl-right-tabs"></div>');
    rightTabs.append(
        $('<div class="csl-right-tab" data-tab="settings">设置</div>'),
        $('<div class="csl-right-tab" data-tab="vendor">Vendor</div>'),
    );
    right.append(rightTabs, $('<div class="csl-right-content"></div>'));
    body.append(right);

    panel.append(body);
    overlay.append(panel);

    // 事件：点击遮罩关闭
    overlay.on('click', (e) => {
        if (e.target === overlay[0]) closeConsolePanel();
    });

    // 事件：tab 切换
    rightTabs.on('click', '.csl-right-tab', function () {
        rightTab = $(this).data('tab') as typeof rightTab;
        refreshRightPanel();
    });


    overlayEl = overlay;
    document.body.append(overlay[0]);
    return overlay;
}

// ── 搜索过滤 ──

function filterDashboard(): void {
    const list = overlayEl?.find('.csl-left-list');
    if (!list?.length) return;
    const input = overlayEl!.find('.csl-left-search input');
    const q = String(input.val() ?? '').toLowerCase().trim();
    list.find('.csl-model-row').each(function () {
        const search = String($(this).data('search') || '');
        $(this).toggle(!q || search.includes(q));
    });
}

// ── 各栏渲染 ──

function refreshDashboard(): void {
    const leftList = overlayEl?.find('.csl-left-list');
    if (!leftList?.length) return;
    renderDashboard(leftList, selectedLogicalId, (logicalId) => {
        selectedLogicalId = logicalId;
        refreshDashboard();
        refreshCenterPanel();
    });
}

function refreshCenterPanel(): void {
    const detailContent = overlayEl?.find('.csl-route-list');
    if (!detailContent?.length) return;
    const detailHead = overlayEl?.find('.csl-detail-head');
    if (detailHead?.length) {
        const model = selectedLogicalId ? logicalModels().find(m => m.id === selectedLogicalId) : undefined;
        detailHead.find('.csl-detail-title').text(model ? `${model.name} 路由` : '路由详情');
    }
    renderRouteDetail(detailContent, selectedLogicalId, () => {
        selectedLogicalId = null;
        refreshDashboard();
        refreshCenterPanel();
    }, () => {
        refreshDashboard();
        refreshCenterPanel();
    });
}

function refreshRightPanel(): void {
    const rightContent = overlayEl?.find('.csl-right-content');
    if (!rightContent?.length) return;
    const tabs = overlayEl?.find('.csl-right-tab');
    tabs?.removeClass('is-active').filter(`[data-tab="${rightTab}"]`).addClass('is-active');
    switch (rightTab) {
        case 'settings': {
            // 「设置」tab = 路由功能（参数/分组/模型/数据）+ 映射规则/忽略
            const routeSection = $('<div class="csl-settings-block"></div>');
            const mappingSection = $('<div class="csl-settings-block"></div>');
            renderRightRoute(routeSection, () => { refreshDashboard(); refreshCenterPanel(); }, () => { refreshRightPanel(); });
            renderRightMapping(mappingSection, () => { refreshDashboard(); refreshCenterPanel(); });
            rightContent.empty().append(routeSection, mappingSection);
            break;
        }
        case 'vendor':
            renderRightVendor(rightContent, () => { refreshDashboard(); refreshCenterPanel(); });
            break;
    }
}

function refreshAll(): void {
    refreshDashboard();
    refreshCenterPanel();
    refreshRightPanel();
}

// ── 公开 API ──

export function openConsolePanel(): void {
    debugLog('openConsolePanel');
    if (isMobileViewport()) {
        openConsolePanelMobile();
        return;
    }
    if (isOpen) {
        // 已打开，前置到最前
        if (overlayEl?.length) document.body.append(overlayEl[0]);
        return;
    }
    isOpen = true;
    const overlay = ensurePanel();
    overlay.addClass('csl-overlay--open');
    document.body.style.overflow = 'hidden';
    observationListener = () => { if (isOpen) refreshCenterPanel(); };
    window.addEventListener(MODEL_OBSERVATION_RECORDED_EVENT, observationListener);
    $(document).on('keydown.quickerApiConsole', (e) => {
        if (e.key === 'Escape' && isOpen) closeConsolePanel();
    });
    refreshAll();
    debugLog('console panel opened');
}

export function closeConsolePanel(): void {
    debugLog('closeConsolePanel');
    if (!isOpen) return;
    isOpen = false;
    if (observationListener) {
        window.removeEventListener(MODEL_OBSERVATION_RECORDED_EVENT, observationListener);
        observationListener = null;
    }
    // 关闭时从 DOM 移除 overlay，避免透明全屏层继续拦截鼠标事件
    overlayEl?.remove();
    overlayEl = null;
    document.body.style.overflow = '';
    $(document).off('keydown.quickerApiConsole');
    debugLog('console panel closed');
}