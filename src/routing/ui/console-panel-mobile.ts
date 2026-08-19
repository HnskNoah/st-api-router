// 手机端路由面板：底部弹出 Sheet，单列复用现有渲染函数。
// 桌面走 console-panel.ts（三栏浮层），isMobile 时由 openConsolePanel 路由到这里。

import { debugLog } from '../../debug.js';
import { activeGroup, logicalModels } from '../../settings/access.js';
import { renderDashboard } from './dashboard.js';
import { renderRouteDetail } from './route-detail.js';
import { renderRightSettings } from './right-settings.js';
import { renderRightVendor } from './right-vendor.js';
import { renderRightRoute } from './right-route.js';
import { ensureConsolePanelStyles } from './console-panel-styles.js';

let overlayEl: JQuery<HTMLElement> | null = null;
let sheetEl: JQuery<HTMLElement> | null = null;
let isOpen = false;
let selectedLogicalId: string | null = null;
let tab: 'models' | 'manage' = 'models';
let manageTab: 'settings' | 'vendor' | 'route' = 'settings';

export function isMobileViewport(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches;
}

function ensureStyles(): void {
    ensureConsolePanelStyles();
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
            background: var(--SmartThemeBlurTintColor, #1a1d23);
            border-top: 1px solid rgba(128,128,128,0.3);
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
            border-radius: 2px; background: rgba(128,128,128,0.4);
        }
        .qam-head {
            display: flex; align-items: center; gap: 8px;
            padding: 6px 12px 8px; border-bottom: 1px solid rgba(128,128,128,0.15);
            flex: none;
        }
        .qam-current {
            flex: 1; min-width: 0; font-weight: 600; font-size: 14px;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .qam-close { flex: none; cursor: pointer; font-size: 16px; color: #999; padding: 4px; }
        .qam-body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 0; }
        .qam-tabs { flex: none; display: flex; border-top: 1px solid rgba(128,128,128,0.15); }
        .qam-tab {
            flex: 1; text-align: center; padding: 8px 2px; font-size: 12px;
            cursor: pointer; color: #999; border-top: 2px solid transparent;
        }
        .qam-tab.active { color: var(--SmartThemeBodyColor, #e8e8e8); border-top-color: #5b9bd5; }
        .qam-manage-tabs { display: flex; border-bottom: 1px solid rgba(128,128,128,0.15); }
        .qam-manage-tab { flex: 1; text-align: center; padding: 6px 2px; font-size: 11px; cursor: pointer; color: #999; }
        .qam-manage-tab.active { color: #5b9bd5; }
        .qam-empty { font-size: 12px; color: #999; padding: 16px 10px; }
        .qam-search { padding: 6px 10px; flex: none; }
        .qam-search > input { width: 100%; margin: 0; box-sizing: border-box; }
    `).appendTo(document.head);
}

function currentModelName(): string {
    const group = activeGroup();
    if (!group?.currentLogicalModelId) return '未选择逻辑模型';
    const m = logicalModels().find(item => item.id === group.currentLogicalModelId);
    return m?.name ?? '未选择逻辑模型';
}

function openMobilePanel(): void {
    debugLog('openMobilePanel', { isOpen });
    ensureStyles();

    const overlay = $('<div class="qam-overlay"></div>');
    const sheet = $('<div class="qam-sheet"></div>');

    const handle = $('<div class="qam-handle" role="button" tabindex="0" title="收起"></div>');
    const head = $('<div class="qam-head"></div>');
    const current = $('<span class="qam-current"></span>').text(currentModelName()).attr('title', currentModelName());
    const closeBtn = $('<span class="qam-close" role="button" tabindex="0" title="关闭"><i class="fa-solid fa-xmark"></i></span>');
    head.append(current, closeBtn);

    const body = $('<div class="qam-body"></div>');
    const tabs = $('<div class="qam-tabs"></div>');
    const modelsTab = $('<div class="qam-tab"></div>').text('模型').attr('data-tab', 'models')
        .on('click', () => { tab = 'models'; renderCards(); renderBody(); });
    const manageTabEl = $('<div class="qam-tab"></div>').text('管理').attr('data-tab', 'manage')
        .on('click', () => { tab = 'manage'; renderCards(); renderBody(); });
    tabs.append(modelsTab, manageTabEl);

    sheet.append(handle, head, body, tabs);
    overlay.append(sheet);
    document.body.append(overlay[0]);

    overlayEl = overlay;
    sheetEl = sheet;

    overlay.on('click', (e) => { if (e.target === overlay[0]) closeMobilePanel(); });
    handle.on('click', () => closeMobilePanel());
    handle.on('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeMobilePanel(); } });
    closeBtn.on('click', () => closeMobilePanel());
    closeBtn.on('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeMobilePanel(); } });

    renderCards();
    renderBody();
    isOpen = true;
    requestAnimationFrame(() => { overlay.addClass('open'); sheet.addClass('open'); });
}

function renderCards(): void {
    const t = sheetEl?.find('.qam-tab');
    t?.removeClass('active').filter(`[data-tab="${tab}"]`).addClass('active');
}

function renderBody(): void {
    if (!sheetEl) return;
    const body = sheetEl.find('.qam-body');
    body.empty();
    if (tab === 'models') renderModels(body);
    else renderManage(body);
}

/** 模型 tab：复用仪表盘（模型列表）；点模型 → 展示该模型路由详情。 */
function renderModels(body: JQuery<HTMLElement>): void {
    if (selectedLogicalId) {
        renderRouteDetail(body, selectedLogicalId, () => {
            selectedLogicalId = null;
            body.empty();
            renderModels(body);
        }, () => {
            body.empty();
            renderModels(body);
        });
        return;
    }
    // 搜索框（过滤 data-search）
    const searchWrap = $('<div class="qam-search"></div>');
    const search = $('<input class="text_pole" type="search" maxlength="200" placeholder="搜索模型…">')
        .on('input', () => {
            const q = String(search.val() ?? '').trim().toLowerCase();
            body.find('.csl-model-row').each(function () {
                const matches = !q || String($(this).attr('data-search') || '').includes(q);
                $(this).toggle(matches);
            });
        });
    searchWrap.append(search);
    body.append(searchWrap);
    renderDashboard(body, null, (id) => {
        selectedLogicalId = id;
        body.empty();
        renderModels(body);
    });
}

/** 管理 tab：子 tab（设置 / Vendor / 路由），复用 right-* 渲染。 */
function renderManage(body: JQuery<HTMLElement>): void {
    const tabs = $('<div class="qam-manage-tabs"></div>');
    const mk = (label: string, k: 'settings' | 'vendor' | 'route') => $('<div class="qam-manage-tab"></div>')
        .text(label).attr('data-mtab', k).on('click', () => { manageTab = k; renderManageTabs(tabs); renderManagePane(body, true); });
    tabs.append(mk('设置', 'settings'), mk('Vendor', 'vendor'), mk('路由', 'route'));
    body.append(tabs);
    renderManageTabs(tabs);
    renderManagePane(body, true);
}

function renderManageTabs(tabsEl: JQuery<HTMLElement>): void {
    tabsEl.find('.qam-manage-tab').removeClass('active').filter(`[data-mtab="${manageTab}"]`).addClass('active');
}

function renderManagePane(container: JQuery<HTMLElement>, replace: boolean): void {
    const pane = replace ? $('<div class="qam-manage-pane"></div>') : container.find('.qam-manage-pane').first();
    if (replace) {
        container.find('.qam-manage-pane').remove();
        container.append(pane);
    }
    if (!pane.length) return;
    pane.empty();
    if (manageTab === 'settings') renderRightSettings(pane);
    else if (manageTab === 'vendor') renderRightVendor(pane, () => renderManagePane(container, true));
    else renderRightRoute(pane, () => renderManagePane(container, true), () => renderManagePane(container, true));
}

export function closeMobilePanel(): void {
    debugLog('closeMobilePanel', { isOpen });
    if (!isOpen && !overlayEl) return;
    isOpen = false;
    overlayEl?.removeClass('open');
    sheetEl?.removeClass('open');
    setTimeout(() => {
        overlayEl?.remove();
        overlayEl = null;
        sheetEl = null;
    }, 260);
}

/** 由桌面 openConsolePanel 在 isMobile 时路由到这里。 */
export function openConsolePanelMobile(): void {
    // 已打开则前置
    if (overlayEl?.length) { document.body.append(overlayEl[0]); return; }
    openMobilePanel();
}
