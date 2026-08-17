// Vendor / LogicalModel / Group 管理面板。
// deps 由 lifecycle 注入，避免循环 import。
// 模型获取复用宿主后端通道（/api/backends/chat-completions/status），并把结果落到 entry.fetchedModels。

import { getRequestHeaders, setOnlineStatus } from '@sillytavern/script';
import { SECRET_KEYS, writeSecret } from '@sillytavern/scripts/secrets';
import { POPUP_TYPE, Popup } from '@sillytavern/scripts/popup';
import { escapeHtml } from '../utils/text.js';
import { makeId } from '../utils/id.js';
import { isKeyUnused, isVendorUnused } from './ui-helpers.js';
import { normalizeRoutingSettings } from '../domain/routing.js';
import {
    assignModelToLogical,
    assignRealModel,
    buildLogicalModelsFromFetched,
    buildModelListText,
    deleteLogicalModel,
    disableVendorIfNoUsableKeys,
    findUnmappedModels,
    isRealModelUsable,
    isSpecialVariant,
    mappedRealModels,
    mergeImportedRoutingConfig,
    mergeLogicalModels,
    normalizeGroup,
    normalizeLogicalModel,
    normalizeVendor,
    pruneOrphanLogicalModels,
    reconcileEntryMappings,
    resetModelData,
    sanitizeGroupForExport,
    sortedLogicalModels,
    unmapRealModel,
} from '../domain/vendor.js';
import { clearQuickApiSecrets, ensureEmptySecret, readAuthoritativeSecretState, rotateSecretVerified } from '../secrets/api.js';
import { exportDebugLog } from '../debug.js';
import type { Group, GroupEntry, LogicalModel, RoutingSettings, Vendor, VendorModelMapping } from '../types.js';

export interface RoutingUIDeps {
    getVendors(): Vendor[];
    getGroups(): Group[];
    getLogicalModels(): LogicalModel[];
    getActiveGroupId(): string | null;
    setActiveGroupId(id: string | null): void;
    getRouting(): RoutingSettings;
    save(): void;
}

const FORMAT_LABELS: Record<string, string> = { 'custom': 'OpenAI 兼容', 'deepseek': 'DeepSeek' };

function statusBadge(reason: string | null): string {
    const label: Record<string, string> = { disabled: '禁用', rpm: '限流' };
    return `<span class="st-router-badge st-router-badge--${reason ?? 'ok'}">${reason ? (label[reason] ?? reason) : '可用'}</span>`;
}

export function initRoutingUI(deps: RoutingUIDeps): { panel: JQuery<HTMLElement>; render(): void } {
    if (!$('#st_router_styles').length) {
        $('<style id="st_router_styles"></style>').text(`
            /* ── 面板整体 ── */
            #st_router_panel.quicker-api { width: 100%; }
            #st_router_panel .st-router-title-actions { display: flex; gap: 6px; align-items: center; }

            /* ── 分区卡片 ── */
            .st-router-section {
                border: 1px solid rgba(128, 128, 128, 0.25);
                border-radius: 8px;
                padding: 10px 12px;
                margin-bottom: 12px;
                background: rgba(0, 0, 0, 0.12);
            }
            .st-router-section-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
            .st-router-section-title { font-weight: 600; font-size: 13px; }
            .st-router-step-badge {
                width: 20px; height: 20px; border-radius: 50%; flex: none;
                background: #5b6d7a; color: #fff; font-size: 12px;
                display: inline-flex; align-items: center; justify-content: center;
            }
            .st-router-section-tools { margin-left: auto; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

            /* ── 主开关区 ── */
            .st-router-section--master { display: flex; flex-direction: column; gap: 6px; }
            .st-router-master-toggle { font-weight: 600; font-size: 14px; }
            .st-router-master-hint { font-size: 12px; color: #999; }
            .st-router-master-row { display: flex; align-items: center; gap: 6px; font-size: 13px; flex-wrap: wrap; }
            .st-router-sticky-input { width: 80px; }

            /* ── 分组摘要 ── */
            .st-router-summary {
                font-size: 12px; color: #ccc; padding: 5px 9px;
                background: rgba(255, 255, 255, 0.05); border-radius: 6px; line-height: 1.5;
            }

            /* ── Vendor 容器（可展开） ── */
            .st-router-provider-container { margin-bottom: 4px; }
            .st-router-provider-container:last-child { margin-bottom: 0; }
            .st-router-provider {
                display: flex; align-items: center; gap: 8px; padding: 8px 0;
                border-bottom: 1px solid rgba(255, 255, 255, 0.07); flex-wrap: wrap;
            }
            .st-router-provider:last-child { border-bottom: none; }
            .st-router-provider--unused { opacity: 0.45; }
            .st-router-provider-info { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
            .st-router-provider-name { flex: none; font-weight: 600; white-space: nowrap; }
            .st-router-provider-endpoint {
                width: 180px; max-width: 55%; flex: none; margin: 0;
            }
            .st-router-provider-meta { flex-basis: 100%; font-size: 12px; color: #999; opacity: 0.9; }
            .st-router-provider-actions { flex: none; display: flex; gap: 4px; }
            .st-router-provider-expand {
                flex: none; font-size: 11px; cursor: pointer; transition: transform 0.15s;
                color: #5b9bd5; padding: 4px;
            }
            .st-router-provider-expand--open { transform: rotate(90deg); }

            /* ── Vendor 下的 Key 列表 ── */
            .st-router-keys {
                padding: 4px 0 8px 28px; border-bottom: 1px solid rgba(255, 255, 255, 0.07);
            }
            .st-router-keys:last-child { border-bottom: none; }
            .st-router-key-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; flex-wrap: wrap; }
            .st-router-key-row--header { font-size: 12px; color: #999; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
            .st-router-key-row--unused { opacity: 0.45; }
            .st-router-key-row > input[type="password"] { width: auto; flex: 2 1 180px; min-width: 140px; margin: 0; }
            .st-router-key-row > input[type="text"] { width: auto; flex: 1 1 90px; min-width: 70px; margin: 0; }
            .st-router-key-row > input[type="checkbox"] { flex: none; }
            .st-router-key-row > .menu_button { flex: none; }
            .st-router-key-col { flex: 1 1 0; min-width: 0; font-size: 12px; color: #999; }

            /* ── 状态徽章 ── */
            .st-router-badge {
                flex: none; font-size: 11px; padding: 2px 8px; border-radius: 10px;
                border: 1px solid rgba(128, 128, 128, 0.4); color: #aaa;
            }
            .st-router-badge--ok { color: #7ecf8a; border-color: rgba(126, 207, 138, 0.5); }
            .st-router-badge--disabled { color: #e08a8a; border-color: rgba(224, 138, 138, 0.5); }
            .st-router-badge--rpm { color: #e0c07e; border-color: rgba(224, 192, 126, 0.5); }

            /* ── 逻辑模型 chips ── */
            .st-router-model-list { display: flex; flex-wrap: wrap; gap: 8px; padding: 4px 12px 12px; }
            .st-router-model-chip {
                display: inline-flex; align-items: center; gap: 8px;
                border: 1px solid rgba(128, 128, 128, 0.35); border-radius: 16px;
                padding: 4px 12px; cursor: pointer; background: rgba(255, 255, 255, 0.04);
                color: inherit; font-size: 13px; transition: border-color 0.15s, background 0.15s;
                flex-wrap: nowrap; max-width: 100%;
            }
            .st-router-model-chip:hover { border-color: #5b9bd5; }
            .st-router-model-chip.is-selected {
                border-color: #5b9bd5; background: rgba(91, 155, 213, 0.18);
            }
            .st-router-model-name { font-weight: 600; min-width: 0; }
            .st-router-model-providers { font-size: 11px; color: #999; }
            .st-router-model-edit {
                font-size: 11px; color: #999; cursor: pointer; padding: 0 2px;
                border-radius: 4px; display: inline-flex; align-items: center; flex: none; white-space: nowrap;
            }
            .st-router-model-edit:hover { color: #5b9bd5; background: rgba(91, 155, 213, 0.15); }

            /* ── 真实模型折叠区（已归类 / 未归类，胶囊行）── */
            .st-router-real-fold {
                border: 1px solid rgba(128, 128, 128, 0.22);
                border-radius: 8px; background: rgba(0, 0, 0, 0.10);
                overflow: hidden; margin-top: 10px;
            }
            .st-router-model-search {
                display: flex; align-items: center; gap: 6px; margin-top: 8px;
                border: 1px solid rgba(128, 128, 128, 0.25); border-radius: 6px;
                background: rgba(0, 0, 0, 0.08); padding: 2px 8px;
            }
            .st-router-model-search > i { color: #999; font-size: 12px; flex: none; }
            .st-router-model-search > input.text_pole { flex: 1 1 0; min-width: 0; margin: 0; width: auto; }
            .st-router-real-head {
                display: flex; align-items: center; gap: 8px; cursor: pointer;
                user-select: none; font-size: 13px; color: #ccc;
                padding: 8px 12px; transition: background 0.15s;
            }
            .st-router-real-head:hover { background: rgba(255, 255, 255, 0.04); color: #fff; }
            .st-router-real-arrow { color: #5b9bd5; flex: none; font-size: 11px; transition: transform 0.15s; }
            .st-router-real-arrow--open { transform: rotate(90deg); }
            .st-router-real-count {
                margin-left: auto; font-size: 11px; color: #999;
                background: rgba(255, 255, 255, 0.07); border-radius: 10px; padding: 1px 8px;
            }
            .st-router-real-rows { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 12px 12px; }
            /* 真实模型 pill：复用逻辑模型 chip 外观；点击展开下方操作行（下拉 + 🔗） */
            .st-router-real-pill-wrap { display: contents; }
            .st-router-real-pill { max-width: 100%; }
            .st-router-real-pill--disabled { opacity: 0.45; cursor: default; }
            .st-router-real-pill--disabled:hover { border-color: rgba(128, 128, 128, 0.35); }
            .st-router-real-pill .st-router-model-name { font-family: monospace; font-size: 12px; word-break: break-all; min-width: 0; }
            .st-router-real-ops {
                display: flex; align-items: center; gap: 6px; flex-basis: 100%;
                padding: 2px 2px 8px; flex-wrap: wrap;
            }
            .st-router-real-ops > select.text_pole { width: auto; max-width: 220px; margin: 0; flex: none; font-size: 12px; }
            .st-router-real-ops > .menu_button { flex: none; padding: 2px 8px; }

            /* ── 空状态 ── */
            .st-router-empty { font-size: 12px; color: #999; padding: 8px 2px; line-height: 1.6; }

            /* ── 字段提示 ? ── */
            .quicker-api__field-hint {
                display: inline-block; margin-left: 6px; width: 15px; height: 15px; line-height: 15px;
                border-radius: 50%; background: #6c757d; color: #fff; font-size: 11px;
                text-align: center; cursor: help; vertical-align: middle;
            }

            /* ── 编辑弹窗 ── */
            .st-router-editor { max-height: 70vh; overflow-y: auto; padding-right: 4px; }
        `).appendTo(document.head);
    }
    const panel = $(`
        <section id="st_router_panel" class="quicker-api">
            <div class="quicker-api__title">
                <span><i class="fa-solid fa-route"></i> ST Api Router</span>
                <span class="st-router-title-actions">
                    <button id="st_router_toggle_legacy" class="menu_button" type="button" title="旧版 API Profile 设置（过渡兼容）"><i class="fa-solid fa-clock-rotate-left"></i><span>旧版设置</span></button>
                </span>
            </div>

            <div class="st-router-section st-router-section--master">
                <label class="checkbox_label st-router-master-toggle" for="st_router_enable"><input id="st_router_enable" type="checkbox" /> 启用路由</label>
                <div class="st-router-master-row">
                    <label for="st_router_sticky_count">保持同一 Vendor：</label>
                    <input id="st_router_sticky_count" class="text_pole st-router-sticky-input" type="number" min="0" step="1" />
                    <span>次（0 = 每次生成都重新随机）</span>
                </div>
                <div class="st-router-master-hint">启用后，每次生成前按当前分组的逻辑模型，从可用 Vendor 中随机选一个改写 SillyTavern 连接（不发请求，只改连接字段）。</div>
            </div>

            <div class="st-router-section">
                <div class="st-router-section-head">
                    <span class="st-router-step-badge">1</span><span class="st-router-section-title">分组</span>
                    <div class="st-router-section-tools">
                        <select id="st_router_group_select" class="text_pole" style="min-width: 140px;"></select>
                        <button id="st_router_add_group" class="menu_button" type="button"><i class="fa-solid fa-plus"></i><span>新增分组</span></button>
                        <button id="st_router_edit_group" class="menu_button" type="button" title="编辑分组名称与当前逻辑模型"><i class="fa-solid fa-pen"></i></button>
                    </div>
                </div>
                <div id="st_router_group_summary" class="st-router-summary"></div>
            </div>

            <div class="st-router-section">
                <div class="st-router-section-head">
                    <span class="st-router-step-badge">2</span><span class="st-router-section-title">Vendor（模型商）</span>
                    <div class="st-router-section-tools">
                        <button id="st_router_add_provider" class="menu_button" type="button"><i class="fa-solid fa-plus"></i><span>新增 Vendor</span></button>
                    </div>
                </div>
                <div id="st_router_provider_list" class="st-router-list"></div>
            </div>

            <div class="st-router-section">
                <div class="st-router-section-head">
                    <span class="st-router-step-badge">3</span><span class="st-router-section-title">逻辑模型</span>
                    <div class="st-router-section-tools">
                        <button id="st_router_refresh_models" class="menu_button" type="button" title="用各 Vendor 已配置的 Key 重新拉取模型并刷新列表（无 Key 的 Vendor 跳过）"><i class="fa-solid fa-arrows-rotate"></i><span>刷新模型</span></button>
                        <button id="st_router_build_logical" class="menu_button" type="button" title="为每个已拉取的真实模型单独创建逻辑模型并自动映射（跳过 search/thinking/image/cache 变体）"><i class="fa-solid fa-wand-magic-sparkles"></i><span>从已拉取模型创建</span></button>
                        <button id="st_router_add_logical" class="menu_button" type="button" title="手动添加逻辑模型（可填自动归类正则）"><i class="fa-solid fa-plus"></i><span>添加逻辑模型</span></button>
                        <div style="position:relative;display:inline-block">
                            <button id="st_router_more" class="menu_button" type="button" title="更多操作"><i class="fa-solid fa-ellipsis"></i></button>
                            <div id="st_router_more_menu" class="quicker-api__dropdown-menu" style="display:none;position:absolute;right:0;top:100%;z-index:100;background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:4px 0;min-width:170px;box-shadow:0 4px 12px rgba(0,0,0,.3)">
                                <button id="st_router_export_data" class="quicker-api__menu-item" type="button"><i class="fa-solid fa-file-export"></i> 导出数据</button>
                                <button id="st_router_import_data" class="quicker-api__menu-item" type="button"><i class="fa-solid fa-file-import"></i> 导入数据</button>
                                <button id="st_router_export_models" class="quicker-api__menu-item" type="button"><i class="fa-solid fa-download"></i> 导出模型列表</button>
                                <button id="st_router_export_log" class="quicker-api__menu-item" type="button"><i class="fa-solid fa-file-lines"></i> 导出日志</button>
                                <button id="st_router_reset_models" class="quicker-api__menu-item" type="button" style="color:var(--quicker-api-danger)"><i class="fa-solid fa-broom"></i> 重置模型数据</button>
                                <!-- 临时功能：一键清除插件写入的 ST secret，后续按需删除该按钮 -->
                                <button id="st_router_clear_secrets" class="quicker-api__menu-item" type="button" style="color:var(--quicker-api-danger)"><i class="fa-solid fa-trash"></i> 一键清除 ST secret</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="st-router-model-search">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input id="st_router_model_search" class="text_pole" type="search" maxlength="200" placeholder="搜索逻辑模型 / 真实模型…">
                </div>
                <div id="st_router_logical" class="st-router-real-fold"></div>
                <div id="st_router_mapped" class="st-router-real-fold"></div>
                <div id="st_router_unmapped" class="st-router-real-fold"></div>
            </div>
        </section>
    `);

    const providerList = panel.find('#st_router_provider_list');
    const logicalList = panel.find('#st_router_logical');
    const mappedList = panel.find('#st_router_mapped');
    const unmappedList = panel.find('#st_router_unmapped');
    const groupSummary = panel.find('#st_router_group_summary');

    function renderRoutingControls(): void {
        const routing = deps.getRouting();
        panel.find('#st_router_enable').prop('checked', routing.enabled);
        panel.find('#st_router_sticky_count').val(Number(routing.stickyCount) || 0);
    }

    function renderGroupSelect(): void {
        const select = panel.find('#st_router_group_select');
        const groups = deps.getGroups();
        select.empty();
        for (const group of groups) {
            select.append($('<option>').val(group.id).text(group.name));
        }
        const activeId = deps.getActiveGroupId() && groups.some(group => group.id === deps.getActiveGroupId())
            ? deps.getActiveGroupId()
            : groups[0]?.id || '';
        select.val(activeId || '');
        renderGroupSummary();
    }

    function renderGroupSummary(): void {
        const group = activeGroup();
        groupSummary.empty();
        if (!group) {
            groupSummary.text('还没有分组。点击"新增分组"创建一套独立的 Vendor + Key 环境。');
            return;
        }
        const model = deps.getLogicalModels().find(item => item.id === group.currentLogicalModelId);
        const keyCount = group.entries.length;
        const enabled = group.enabled ? '启用' : '已停用';
        groupSummary.text(`「${group.name}」· ${enabled} · 当前模型：${model?.name || '（未选择）'} · Key 条目：${keyCount} 个`);
    }

    function activeGroup(): Group | null {
        const id = String(panel.find('#st_router_group_select').val() || '');
        return deps.getGroups().find(group => group.id === id) || deps.getGroups()[0] || null;
    }

    const expandedVendors = new Set<string>();

    let logicalExpanded = false;
    let mappedExpanded = false;
    let unmappedExpanded = false;
    let logicalOptionsHtml = '';

    function refreshLogicalOptionsHtml(): void {
        const options = sortedLogicalModels(deps.getLogicalModels()).map(model => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.name)}</option>`).join('');
        logicalOptionsHtml = `<option value="">— 选择逻辑模型 —</option>${options}`;
    }

    function renderModelList(): void {
        refreshLogicalOptionsHtml();
        const group = activeGroup();
        const models = sortedLogicalModels(deps.getLogicalModels());
        const entries = deps.getGroups().flatMap(item => item.entries);
        logicalList.empty();
        const head = $('<div class="st-router-real-head" role="button" tabindex="0"></div>');
        const arrow = $('<i class="fa-solid fa-chevron-right st-router-real-arrow"></i>');
        if (logicalExpanded) arrow.addClass('st-router-real-arrow--open');
        head.append(arrow);
        head.append($('<span>').text('逻辑模型'));
        head.append($('<span class="st-router-real-count"></span>').text(`${models.length} 个`));
        const rows = $('<div class="st-router-model-list"></div>');
        const ensureRows = () => {
            if (rows.children().length > 0) return;
            if (models.length === 0) {
                rows.append($('<div class="st-router-empty">').text('还没有逻辑模型。可在下方"当前分组 Key"填 Key 后点 ↻ 拉取自动生成，或点击右上角"添加逻辑模型"手动创建。'));
                return;
            }
            for (const model of models) {
                const chip = $('<button class="st-router-model-chip" type="button"></button>')
                    .attr('data-search', String(model.name).toLowerCase())
                    .append($('<span class="st-router-model-name">').text(model.name));
                const mappedEntries = entries.filter(entry => entry.mappings.some(mapping => mapping.logicalModelId === model.id));
                const mappedCount = mappedEntries.reduce((sum, entry) => sum + entry.mappings.filter(mapping => mapping.logicalModelId === model.id).length, 0);
                const vendorNames = [...new Set(mappedEntries.map(entry => {
                    const vendor = deps.getVendors().find(item => item.id === entry.vendorId);
                    return vendor?.name || entry.vendorId;
                }))];
                const vendorText = vendorNames.length > 0 ? ` · ${vendorNames.join('、')}` : '';
                chip.append($('<span class="st-router-model-providers">').text(
                    model.matchPattern ? `正则匹配 ${mappedCount} 个模型 · ${mappedEntries.length} 个 Key${vendorText}` : `${mappedCount} 个模型 · ${mappedEntries.length} 个 Key${vendorText}`,
                ));
                if (group?.currentLogicalModelId === model.id) chip.addClass('is-selected');
                chip.attr('title', group ? '点击设为当前分组的逻辑模型' : '');
                chip.on('click', () => {
                    if (!group) return;
                    group.currentLogicalModelId = model.id;
                    deps.save();
                    renderModelList();
                    renderGroupSummary();
                    setOnlineStatus('已启用');
                });
                const editBtn = $('<span class="st-router-model-edit" role="button" tabindex="0" title="编辑正则与名称"><i class="fa-solid fa-sliders"></i></span>')
                    .on('click', event => {
                        event.stopPropagation();
                        void openLogicalModelEditor(model);
                    });
                const deleteBtn = $('<span class="st-router-model-edit quicker-api__delete-button" role="button" tabindex="0" title="删除该逻辑模型及名下映射"><i class="fa-solid fa-trash"></i></span>')
                    .on('click', async event => {
                        event.stopPropagation();
                        const confirm = await Popup.show.confirm('删除逻辑模型', `确定删除逻辑模型「${escapeHtml(model.name)}」及其名下全部映射？`);
                        if (!confirm) return;
                        const result = deleteLogicalModel(deps.getLogicalModels(), deps.getGroups(), model.id);
                        deps.save();
                        renderModelList();
                        renderGroupSummary();
                        toastr.success(`已删除逻辑模型「${model.name}」，移除 ${result.removedMappings} 条映射。`);
                    });
                chip.append(editBtn, deleteBtn);
                rows.append(chip);
            }
        };
        head.on('click', () => {
            logicalExpanded = !logicalExpanded;
            arrow.toggleClass('st-router-real-arrow--open', logicalExpanded);
            if (logicalExpanded) {
                ensureRows();
                rows.show();
            } else {
                rows.hide();
            }
        });
        logicalList.append(head);
        if (logicalExpanded) {
            ensureRows();
            rows.show();
        } else {
            rows.hide();
        }
        logicalList.append(rows);
        renderMapped();
        renderUnmapped();
        applyModelSearch();
    }

    function vendorNamesForRealModel(realModel: string): string {
        const names = new Set<string>();
        for (const group of deps.getGroups()) {
            for (const entry of group.entries) {
                const hasModel = entry.fetchedModels.includes(realModel) || entry.mappings.some(mapping => mapping.realModel === realModel);
                if (!hasModel) continue;
                const vendor = deps.getVendors().find(item => item.id === entry.vendorId);
                if (vendor?.name) names.add(vendor.name);
            }
        }
        return names.size > 0 ? [...names].join('、') : '';
    }

    function buildRealPill(realModel: string, currentLogicalId: string, subtitle: string, disabled = false): JQuery<HTMLElement> {
        const wrap = $('<div class="st-router-real-pill-wrap"></div>')
            .attr('data-search', `${realModel} ${subtitle}`.toLowerCase());
        const pill = $('<button class="st-router-model-chip st-router-real-pill" type="button"></button>')
            .toggleClass('st-router-real-pill--disabled', disabled)
            .prop('disabled', disabled);
        pill.append($('<span class="st-router-model-name">').text(realModel));
        pill.append($('<span class="st-router-model-providers">').text(subtitle));
        const ops = $('<div class="st-router-real-ops"></div>').hide();
        const buildOps = () => {
            if (ops.children().length > 0) return;
            const select = $('<select class="text_pole"></select>').html(logicalOptionsHtml);
            if (currentLogicalId) select.val(currentLogicalId);
            const applyBtn = $('<button class="menu_button" type="button" title="建立/改归属到所选逻辑模型"><i class="fa-solid fa-link"></i></button>')
                .on('click', () => {
                    const logicalId = String(select.val() || '');
                    if (!logicalId) {
                        toastr.warning('请先为模型选择逻辑模型。');
                        return;
                    }
                    const touched = assignModelToLogical(deps.getGroups(), realModel, logicalId);
                    if (touched > 0) {
                        deps.save();
                        renderModelList();
                        renderGroupSummary();
                        toastr.success(`已为「${realModel}」更新归属（影响 ${touched} 个 Key）。`);
                    }
                });
            const unmapBtn = $('<button class="menu_button quicker-api__delete-button" type="button" title="删除该真实模型的映射（移入未归类）"><i class="fa-solid fa-unlink"></i></button>')
                .on('click', () => {
                    const removed = unmapRealModel(deps.getGroups(), realModel);
                    if (removed > 0) {
                        deps.save();
                        renderModelList();
                        renderGroupSummary();
                        toastr.success(`已删除「${realModel}」的 ${removed} 条映射，模型已移入未归类。`);
                    }
                });
            ops.append(select, applyBtn, unmapBtn);
        };
        pill.on('click', () => {
            if (disabled) return;
            const rows = wrap.parent();
            rows.find('.st-router-real-ops').not(ops).hide();
            if (ops.is(':visible')) {
                ops.hide();
            } else {
                buildOps();
                ops.show();
            }
        });
        wrap.append(pill, ops);
        return wrap;
    }

    function renderMapped(): void {
        const mapped = mappedRealModels(deps.getGroups());
        mappedList.empty();
        const head = $('<div class="st-router-real-head" role="button" tabindex="0"></div>');
        const arrow = $('<i class="fa-solid fa-chevron-right st-router-real-arrow"></i>');
        if (mappedExpanded) arrow.addClass('st-router-real-arrow--open');
        head.append(arrow);
        head.append($('<span>').text('已归类真实模型'));
        head.append($('<span class="st-router-real-count"></span>').text(`${mapped.length} 个`));
        const rows = $('<div class="st-router-real-rows"></div>');
        const ensureRows = () => {
            if (rows.children().length > 0) return;
            if (mapped.length === 0) {
                rows.append($('<div class="st-router-empty">').text('还没有已归类的真实模型。在"未归类真实模型"里为模型选择逻辑模型并点 🔗 即可归类。'));
                return;
            }
            for (const item of mapped) {
                const logical = deps.getLogicalModels().find(model => model.id === item.logicalModelId);
                const vendorText = vendorNamesForRealModel(item.realModel);
                const usable = isRealModelUsable(deps.getVendors(), deps.getGroups(), item.realModel);
                rows.append(buildRealPill(
                    item.realModel,
                    item.logicalModelId,
                    `${logical ? `归属：${logical.name}` : '归属：未知'}${vendorText ? ` · Vendor：${vendorText}` : ''}${usable ? '' : ' · 已停用'}`,
                    !usable,
                ));
            }
        };
        head.on('click', () => {
            mappedExpanded = !mappedExpanded;
            arrow.toggleClass('st-router-real-arrow--open', mappedExpanded);
            if (mappedExpanded) {
                ensureRows();
                rows.show();
            } else {
                rows.hide();
            }
        });
        mappedList.append(head);
        if (mappedExpanded) {
            ensureRows();
            rows.show();
        } else {
            rows.hide();
        }
        mappedList.append(rows);
    }

    function renderUnmapped(): void {
        const unmapped = findUnmappedModels(deps.getGroups());
        unmappedList.empty();
        const head = $('<div class="st-router-real-head" role="button" tabindex="0"></div>');
        const arrow = $('<i class="fa-solid fa-chevron-right st-router-real-arrow"></i>');
        if (unmappedExpanded) arrow.addClass('st-router-real-arrow--open');
        head.append(arrow);
        head.append($('<span>').text('未归类真实模型'));
        head.append($('<span class="st-router-real-count"></span>').text(`${unmapped.length} 个`));
        const rows = $('<div class="st-router-real-rows"></div>');
        const ensureRows = () => {
            if (rows.children().length > 0) return;
            if (unmapped.length === 0) {
                rows.append($('<div class="st-router-empty">').text('没有未归类的真实模型。所有已拉取的模型都已归类。'));
                return;
            }
            for (const realModel of unmapped) {
                const vendorText = vendorNamesForRealModel(realModel);
                const usable = isRealModelUsable(deps.getVendors(), deps.getGroups(), realModel);
                rows.append(buildRealPill(realModel, '', `未归类${vendorText ? ` · Vendor：${vendorText}` : ''}${usable ? '' : ' · 已停用'}`, !usable));
            }
        };
        head.on('click', () => {
            unmappedExpanded = !unmappedExpanded;
            arrow.toggleClass('st-router-real-arrow--open', unmappedExpanded);
            if (unmappedExpanded) {
                ensureRows();
                rows.show();
            } else {
                rows.hide();
            }
        });
        unmappedList.append(head);
        if (unmappedExpanded) {
            ensureRows();
            rows.show();
        } else {
            rows.hide();
        }
        unmappedList.append(rows);
    }

    function vendorStatus(vendor: Vendor, now = Date.now()): string | null {
        if (!vendor || vendor.enabled === false) return 'disabled';
        const { window } = windowForVendor(vendor, now);
        const rpm = Number(vendor.rpm) || 0;
        if (rpm > 0 && window.length >= rpm) return 'rpm';
        return null;
    }

    function windowForVendor(vendor: Vendor, now: number): { window: number[]; count: number } {
        const cutoff = now - 60 * 1000;
        const window = (vendor?.window || []).filter(ts => typeof ts === 'number' && ts > cutoff);
        return { window, count: window.length };
    }

    function renderProviderList(): void {
        const vendors = deps.getVendors();
        const group = activeGroup();
        providerList.empty();
        if (vendors.length === 0) {
            providerList.append($('<div class="st-router-empty">').text('还没有 Vendor。点击右上角"新增 Vendor"，填名称与站点地址（Endpoint）。'));
            return;
        }
        for (const vendor of vendors) {
            const container = $('<div class="st-router-provider-container"></div>');
            const row = $('<div class="st-router-provider"></div>');

            // 判断 Vendor 是否未使用
            const vendorKeys = group?.entries.filter(e => e.vendorId === vendor.id) ?? [];
            if (isVendorUnused(vendor, vendor.id, vendorKeys)) row.addClass('st-router-provider--unused');

            const enabledCheck = $('<label class="checkbox_label" title="启用/禁用 Vendor"><input type="checkbox" class="st-router-provider-enabled"></label>');
            enabledCheck.find('input').prop('checked', vendor.enabled).on('change', function () {
                vendor.enabled = $(this).prop('checked');
                if (vendor.enabled) vendor.disabledReason = '';
                deps.save();
                renderProviderList();
                renderModelList();
            });
            row.append(enabledCheck);

            const isExpanded = expandedVendors.has(vendor.id);
            const expandArrow = $('<i class="fa-solid fa-chevron-right st-router-provider-expand"></i>');
            if (isExpanded) expandArrow.addClass('st-router-provider-expand--open');
            expandArrow.on('click', () => {
                if (expandedVendors.has(vendor.id)) expandedVendors.delete(vendor.id);
                else expandedVendors.add(vendor.id);
                renderProviderList();
            });
            row.append(expandArrow);

            const info = $('<div class="st-router-provider-info st-router-provider-info--editable"></div>');
            info.append($('<span class="st-router-provider-name">').text(vendor.name));
            const endpointInput = $('<input class="text_pole st-router-provider-endpoint" type="text" maxlength="2048" placeholder="站点地址，如 https://api.example.com/v1">')
                .val(vendor.endpoint || '')
                .on('input', function () {
                    vendor.endpoint = String($(this).val() ?? '').trim();
                    deps.save();
                });
            info.append(endpointInput);
            const vendorModels = new Set<string>();
            for (const g of deps.getGroups()) {
                for (const entry of g.entries) {
                    if (entry.vendorId !== vendor.id) continue;
                    for (const model of entry.fetchedModels) vendorModels.add(model);
                }
            }
            info.append($('<span class="st-router-provider-meta">').text(
                `${FORMAT_LABELS[vendor.format] ?? vendor.format} · rpm ${vendor.rpm === 0 ? '∞' : vendor.rpm} · 上下文 ${vendor.maxContext || '不限制'} · 输入 ${vendor.maxInputTokens || '不限制'} · 输出 ${vendor.maxOutputTokens || '不限制'} · 已拉取 ${vendorModels.size} 个模型 · 成功率 ${successRateText(vendor)}`,
            ));
            if (vendor.disabledReason) info.append($('<span class="st-router-provider-meta">').text(`已停用：${vendor.disabledReason}`));
            row.append(info);
            row.append(statusBadge(vendorStatus(vendor)));
            const editBtn = $('<button class="menu_button" type="button" title="编辑（格式/RPM/上下文/权重/映射）"><i class="fa-solid fa-pen"></i></button>')
                .on('click', () => void openVendorEditor(vendor));
            const deleteBtn = $('<button class="menu_button quicker-api__delete-button" type="button" title="删除"><i class="fa-solid fa-trash"></i></button>')
                .on('click', async () => {
                    const confirm = await Popup.show.confirm('删除 Vendor', `确定删除「${escapeHtml(vendor.name)}」及其全部模型映射？`);
                    if (!confirm) return;
                    const list = deps.getVendors();
                    const index = list.findIndex(item => item.id === vendor.id);
                    if (index >= 0) list.splice(index, 1);
                    for (const g of deps.getGroups()) g.entries = g.entries.filter(entry => entry.vendorId !== vendor.id);
                    deps.save();
                    renderProviderList();
                    renderModelList();
                    renderGroupSummary();
                });
            const actions = $('<div class="st-router-provider-actions"></div>');
            actions.append(editBtn, deleteBtn);
            row.append(actions);
            container.append(row);

            // 展开的 Key 列表
            if (isExpanded && group) {
                const keySection = $('<div class="st-router-keys"></div>');
                const keysForVendor = group.entries.filter(e => e.vendorId === vendor.id);

                // 表头
                const header = $('<div class="st-router-key-row st-router-key-row--header"></div>');
                header.append(
                    $('<span class="st-router-key-col" style="flex:0 0 30px;">').text('启用'),
                    $('<span class="st-router-key-col" style="flex:0 0 90px;">').text('名称'),
                    $('<span class="st-router-key-col" style="flex:2 1 0;">').text('Key'),
                    $('<span class="st-router-key-col" style="flex:0 0 26px;">').text('拉取'),
                    $('<span class="st-router-key-col" style="flex:0 0 54px;">').text('模型数'),
                    $('<span class="st-router-key-col" style="flex:0 0 26px;">'),
                );
                keySection.append(header);

                if (keysForVendor.length === 0) {
                    keySection.append($('<div class="st-router-empty">').text('该 Vendor 在当前分组还没有 Key。'));
                } else {
                    for (const entry of keysForVendor) {
                        const keyRow = $('<div class="st-router-key-row"></div>');
                        if (isKeyUnused(entry)) keyRow.addClass('st-router-key-row--unused');

                        // 启用
                        const enabled = $('<input type="checkbox" title="启用该 Key">').prop('checked', entry.enabled)
                            .on('change', function () {
                                entry.enabled = $(this).prop('checked');
                                deps.save();
                                keyRow.toggleClass('st-router-key-row--unused', isKeyUnused(entry));
                                row.toggleClass('st-router-provider--unused', isVendorUnused(vendor, vendor.id, vendorKeys));
                            });

                        // 名称
                        const labelInput = $('<input class="text_pole" type="text" maxlength="120" placeholder="名称，如：主号 / 备用">')
                            .val(entry.label || '')
                            .on('input', function () {
                                entry.label = String($(this).val() ?? '').trim() || 'Key';
                                deps.save();
                            });

                        // Key 输入
                        const keyInput = $('<input class="text_pole" type="password" maxlength="2048" autocomplete="off" placeholder="Key">')
                            .val(entry.apiKey || '')
                            .on('input', function () {
                                entry.apiKey = String($(this).val() ?? '').trim();
                                entry.secretId = '';
                                deps.save();
                                // 实时更新未使用状态（Key 行 + 所属 Vendor 行）
                                keyRow.toggleClass('st-router-key-row--unused', isKeyUnused(entry));
                                row.toggleClass('st-router-provider--unused', isVendorUnused(vendor, vendor.id, vendorKeys));
                            });

                        // 拉取
                        const fetchBtn = $('<button class="menu_button" type="button" title="用该 Key 拉取模型并自动映射"><i class="fa-solid fa-arrows-rotate"></i></button>')
                            .on('click', async () => {
                                const key = String(entry.apiKey || '').trim();
                                if (!key) {
                                    toastr.warning('请先填写 Key 再拉取。');
                                    return;
                                }
                                const models = await fetchModelsForVendor(vendor, entry);
                                if (!models) return;
                                renderProviderList();
                                renderModelList();
                                toastr.success(`Vendor「${vendor.name}」获取 ${models.length} 个模型并已映射。`);
                            });

                        // 模型数
                        const modelCount = $('<span class="st-router-key-col" title="该 Key 已拉取的模型数">').text(`${entry.fetchedModels.length} 模型`);

                        // 删除
                        const removeBtn = $('<button class="menu_button quicker-api__delete-button" type="button" title="删除条目"><i class="fa-solid fa-trash"></i></button>')
                            .on('click', () => {
                                group.entries = group.entries.filter(item => item.id !== entry.id);
                                deps.save();
                                renderProviderList();
                                renderGroupSummary();
                            });

                        keyRow.append(enabled, labelInput, keyInput, fetchBtn, modelCount, removeBtn);
                        keySection.append(keyRow);
                    }
                }

                // 添加 Key 按钮
                const addBtn = $('<button class="menu_button st-router-add" type="button" style="margin-top:4px"><i class="fa-solid fa-plus"></i><span>为此 Vendor 添加 Key</span></button>')
                    .on('click', () => {
                        group.entries.push({ id: makeId('group-entry'), vendorId: vendor.id, apiKey: '', label: 'Key', enabled: true, fetchedModels: [], mappings: [] });
                        deps.save();
                        renderProviderList();
                        renderGroupSummary();
                    });
                keySection.append(addBtn);
                container.append(keySection);
            }

            providerList.append(container);
        }
    }

    function successRateText(vendor: Vendor): string {
        const total = (Number(vendor.successes) || 0) + (Number(vendor.failures) || 0);
        if (total <= 0) return '无历史';
        return `${Math.round((Number(vendor.successes) || 0) / total * 100)}%`;
    }

    function field(labelText: string, control: JQuery<HTMLElement>, hint = ''): JQuery<HTMLElement> {
        const label = $('<label></label>').append($('<span>').text(labelText));
        if (hint) label.append($('<span class="quicker-api__field-hint" title=""></span>').attr('title', hint).text('?'));
        return $('<div class="quicker-api__field"></div>').append(label, control);
    }

    async function fetchModelsForVendor(vendor: Vendor, entry: GroupEntry): Promise<string[] | null> {
        const key = entry.apiKey;
        const isDeepseek = vendor.format === 'deepseek';
        const secretKey = isDeepseek ? SECRET_KEYS.DEEPSEEK : SECRET_KEYS.CUSTOM;
        let previousActiveId = '';
        try {
            const authoritative = await readAuthoritativeSecretState();
            previousActiveId = String((authoritative?.[secretKey] || []).find((item: any) => item.active)?.id || '');
            let secretId: string | null = String(entry.secretId || '');
            const existingIds = new Set((authoritative?.[secretKey] || []).map((item: any) => item.id));
            if (key && (!secretId || !existingIds.has(secretId))) {
                secretId = await writeSecret(secretKey, key, `quicker-api:${vendor.name}`);
                if (secretId) entry.secretId = secretId;
            }
            const statusBody: Record<string, any> = {
                chat_completion_source: isDeepseek ? 'deepseek' : 'custom',
                custom_api_format: 'openai_compat',
                ...(secretId ? { secret_id: secretId } : {}),
            };
            if (isDeepseek) statusBody.reverse_proxy = vendor.endpoint;
            else statusBody.custom_url = vendor.endpoint;
            const statusRes = await fetch('/api/backends/chat-completions/status', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify(statusBody),
            });
            if (!statusRes.ok) throw new Error(`status HTTP ${statusRes.status}`);
            const statusData: any = await statusRes.json();
            if (statusData?.error) throw new Error(statusData?.message || 'status 检查失败');
            const raw = statusData?.data;
            const list: any[] = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
            const models: string[] = [...new Set(list.map((item: any) => String(item?.id || item?.model || '').trim()).filter(Boolean))].slice(0, 1000);
            entry.fetchedModels = models;
            for (const model of models) {
                // 跳过 search/thinking/image/cache 特殊变体：不建逻辑模型也不建映射
                if (isSpecialVariant(model)) continue;
                const logical = assignRealModel(deps.getLogicalModels(), model);
                if (!entry.mappings.some(mapping => mapping.realModel === model)) {
                    entry.mappings.push({ id: makeId('mapping'), realModel: model, logicalModelId: logical.id });
                }
            }
            // 以最新拉取结果为权威：清除该 Key 不再存在的真实模型映射，并回收孤儿逻辑模型
            reconcileEntryMappings(entry, models);
            pruneOrphanLogicalModels(deps.getLogicalModels(), deps.getGroups());
            deps.save();
            return models;
        } catch (error) {
            console.error('[QuickerApi] fetch vendor models failed:', error);
            const message = error instanceof Error ? error.message : String(error);
            // 拉取失败视为该 Key 失效：禁用该 Key（enabled=false），保留其他 Key 的模型数据
            entry.enabled = false;
            entry.fetchedModels = [];
            entry.mappings = [];
            const vendorDisabled = disableVendorIfNoUsableKeys(vendor, deps.getGroups());
            deps.save();
            toastr.error(`Key「${entry.label || 'Key'}」（Vendor「${vendor.name}」）获取模型失败，已禁用该 Key：${message}。`);
            if (vendorDisabled) {
                toastr.warning(`Vendor「${vendor.name}」所有 Key 均已失效，已自动禁用。`, '', { timeOut: 8000 });
            }
            return null;
        } finally {
            // 恢复拉取前活动密钥，避免临时 Key 残留占用 ST 密钥槽
            if (previousActiveId) {
                await rotateSecretVerified(secretKey, previousActiveId);
            } else {
                await ensureEmptySecret(secretKey);
            }
        }
    }

    function enabledEntriesForVendor(vendor: Vendor): GroupEntry[] {
        const entries: GroupEntry[] = [];
        for (const group of deps.getGroups()) {
            for (const entry of group.entries) {
                if (entry.vendorId === vendor.id && entry.apiKey && entry.enabled) entries.push(entry);
            }
        }
        return entries;
    }

    /** 拉取间隔抖动：200~400ms 随机，避免多个 Vendor 连发触发限流。 */
    function jitterDelay(): Promise<void> {
        const wait = 200 + Math.floor(Math.random() * 200);
        return new Promise(resolve => setTimeout(resolve, wait));
    }

    function openVendorEditor(vendor: Vendor): void {
        const draft = normalizeVendor(structuredClone(vendor));
        const content = $('<div class="st-router-editor"></div>');
        const nameInput = $('<input class="text_pole" type="text" maxlength="120" placeholder="识别用名称，如：硅基流动">').val(draft.name);
        const formatSelect = $('<select class="text_pole"></select>');
        for (const [value, label] of Object.entries(FORMAT_LABELS)) {
            formatSelect.append($('<option>').val(value).text(label));
        }
        formatSelect.val(draft.format);
        const endpointInput = $('<input class="text_pole" type="text" maxlength="2048" placeholder="custom 系列填 Base URL；deepseek 填反代地址">').val(draft.endpoint);
        const rpmInput = $('<input class="text_pole" type="number" min="0" step="1">').val(draft.rpm);
        const contextInput = $('<input class="text_pole" type="number" min="0" step="1">').val(draft.maxContext);
        const inputTokensInput = $('<input class="text_pole" type="number" min="0" step="1">').val(draft.maxInputTokens);
        const outputTokensInput = $('<input class="text_pole" type="number" min="0" step="1">').val(draft.maxOutputTokens);
        const weightInput = $('<input class="text_pole" type="number" min="0" step="1">').val(draft.weight);
        const enabledCheck = $('<input type="checkbox">').prop('checked', draft.enabled);

        content.append(
            field('名称', nameInput, '列表里用于识别，不会发给站点'),
            field('格式', formatSelect, '决定请求协议：Custom 走 OpenAI 兼容接口；DeepSeek 走 ST 原生 DeepSeek 源'),
            field('Endpoint', endpointInput, '站点 API 地址。custom 系列填 Base URL（如 https://api.xxx.com/v1）；deepseek 填反代地址'),
            field('RPM 上限（0 = 不限）', rpmInput, '该 Vendor 每分钟最多请求次数，所有分组共享此限制'),
            field('上下文上限（0 = 不限制）', contextInput, '路由到该 Vendor 时，SillyTavern 的总上下文预算会被钳制到不超过这个值'),
            field('输入 token 上限（0 = 不限制）', inputTokensInput, '输入 token 预算 = 总上下文 - 输出上限。填了此项会按 输入 + 输出 推导并钳制总上下文'),
            field('输出 token 上限（0 = 不限制）', outputTokensInput, '路由到该 Vendor 时，SillyTavern 的输出 token 上限会被钳制到不超过这个值'),
            field('权重', weightInput, '选路权重：数值越大越容易被随机选中（实际概率还会叠加历史成功率加成）'),
            $('<label class="checkbox_label st-router-editor-enabled"></label>').append(enabledCheck, ' 启用（参与路由）'),
            field('模型数据', $('<div class="st-router-empty">').text('模型列表与归属按 Key 单独存放。请在"当前分组 Key"中为每个 Key 拉取模型，再到"逻辑模型"区的真实模型胶囊里归类。'), '每个 Key 独立保存它拉到的模型；同一个 Vendor 的不同 Key 可能拿到不同模型列表'),
        );

        const saveBtn = $('<button class="menu_button quicker-api__save-button" type="button"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></button>');
        const cancelBtn = $('<button class="menu_button" type="button"><span>取消</span></button>');
        const actions = $('<div class="st-router-editor-actions"></div>').append(saveBtn, cancelBtn);
        content.append(actions);
        const popup = new Popup(content, POPUP_TYPE.TEXT, '', { large: false, wide: true, okButton: false, cancelButton: false });
        saveBtn.on('click', async () => {
            draft.name = String(nameInput.val() ?? '').trim().slice(0, 120) || 'Vendor';
            draft.format = String(formatSelect.val() || 'custom') as Vendor['format'];
            draft.endpoint = String(endpointInput.val() ?? '').trim();
            draft.rpm = Math.max(0, Math.floor(Number(rpmInput.val()) || 0));
            draft.maxContext = Math.max(0, Math.floor(Number(contextInput.val()) || 0));
            draft.maxInputTokens = Math.max(0, Math.floor(Number(inputTokensInput.val()) || 0));
            draft.maxOutputTokens = Math.max(0, Math.floor(Number(outputTokensInput.val()) || 0));
            draft.weight = Math.max(0, Number(weightInput.val()) || 1);
            draft.enabled = enabledCheck.prop('checked');
            Object.assign(vendor, normalizeVendor(draft));
            deps.save();
            renderProviderList();
            renderModelList();
            await popup.completeCancelled();
            toastr.success(`Vendor「${draft.name}」已保存。`);
        });
        cancelBtn.on('click', () => void popup.completeCancelled());
        void popup.show();
    }

    function openGroupEditor(group: Group): void {
        const draft = normalizeGroup(structuredClone(group));
        const content = $('<div class="st-router-editor"></div>');
        const nameInput = $('<input class="text_pole" type="text" maxlength="120" placeholder="分组名称，如：日常 / 深挖">').val(draft.name);
        const enabledCheck = $('<input type="checkbox">').prop('checked', draft.enabled);
        const logicalSelect = $('<select class="text_pole"></select>');
        for (const model of sortedLogicalModels(deps.getLogicalModels())) logicalSelect.append($('<option>').val(model.id).text(model.name));
        logicalSelect.val(draft.currentLogicalModelId);

        const entryList = $('<div class="st-router-list"></div>');
        const vendorOptions = () => deps.getVendors().map(vendor => `<option value="${escapeHtml(vendor.id)}">${escapeHtml(vendor.name)}</option>`).join('');
        const renderEntries = () => {
            entryList.empty();
            for (const entry of draft.entries) {
                const row = $('<div class="st-router-key-row"></div>');
                const vendorSelect = $('<select class="text_pole"></select>').html(`<option value="">— 选择 Vendor —</option>${vendorOptions()}`).val(entry.vendorId);
                const labelInput = $('<input class="text_pole" type="text" maxlength="120" placeholder="名称，如：主号 / 备用">').val(entry.label);
                const keyInput = $('<input class="text_pole" type="password" maxlength="2048" autocomplete="off" placeholder="Key">').val(entry.apiKey);
                const enabled = $('<input type="checkbox">').prop('checked', entry.enabled);
                vendorSelect.on('change', function () { entry.vendorId = String($(this).val() || ''); });
                labelInput.on('input', function () { entry.label = String($(this).val() ?? '').trim() || 'Key'; });
                keyInput.on('input', function () { entry.apiKey = String($(this).val() ?? '').trim(); entry.secretId = ''; });
                enabled.on('change', function () { entry.enabled = $(this).prop('checked'); });
                const removeBtn = $('<button class="menu_button quicker-api__delete-button" type="button" title="删除条目"><i class="fa-solid fa-trash"></i></button>')
                    .on('click', () => {
                        draft.entries = draft.entries.filter(item => item.id !== entry.id);
                        renderEntries();
                    });
                row.append(vendorSelect, labelInput, keyInput, enabled, removeBtn);
                entryList.append(row);
            }
        };
        renderEntries();
        const addEntryBtn = $('<button class="menu_button st-router-add" type="button"><i class="fa-solid fa-plus"></i><span>添加 Vendor + Key</span></button>')
            .on('click', () => {
                draft.entries.push({ id: makeId('group-entry'), vendorId: '', apiKey: '', label: 'Key', enabled: true, fetchedModels: [], mappings: [] });
                renderEntries();
            });

        content.append(
            field('名称', nameInput, '分组名称，如"日常"、"深挖"，仅用于区分环境'),
            field('当前逻辑模型', logicalSelect, '该分组路由时使用的模型；也可在主面板点击逻辑模型快捷切换'),
            $('<label class="checkbox_label st-router-editor-enabled"></label>').append(enabledCheck, ' 启用（该分组参与路由）'),
            field('Vendor + Key 条目', $('<div></div>').append(entryList, addEntryBtn), '每个条目 = 一个可用 Key：选 Vendor、填 Key；同一 Vendor 可多条（多条会一起参与随机，且共享该 Vendor 的 RPM 限制）'),
        );

        const saveBtn = $('<button class="menu_button quicker-api__save-button" type="button"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></button>');
        const cancelBtn = $('<button class="menu_button" type="button"><span>取消</span></button>');
        const actions = $('<div class="st-router-editor-actions"></div>').append(saveBtn, cancelBtn);
        content.append(actions);
        const popup = new Popup(content, POPUP_TYPE.TEXT, '', { large: false, wide: true, okButton: false, cancelButton: false });
        saveBtn.on('click', async () => {
            draft.name = String(nameInput.val() ?? '').trim().slice(0, 120) || '分组';
            draft.enabled = enabledCheck.prop('checked');
            draft.currentLogicalModelId = String(logicalSelect.val() || '');
            Object.assign(group, normalizeGroup(draft));
            deps.save();
            renderGroupSelect();
            renderGroupSummary();
            renderModelList();
            await popup.completeCancelled();
            toastr.success(`分组「${draft.name}」已保存。`);
        });
        cancelBtn.on('click', () => void popup.completeCancelled());
        void popup.show();
    }

    function openLogicalModelEditor(model: LogicalModel | null): void {
        const isNew = !model;
        const draft = isNew
            ? normalizeLogicalModel({ name: '', matchPattern: '' })
            : normalizeLogicalModel(structuredClone(model));
        const content = $('<div class="st-router-editor"></div>');
        const nameInput = $('<input class="text_pole" type="text" maxlength="120" placeholder="逻辑模型名称，如：DeepSeek 系 / Grok 系">').val(draft.name);
        const patternInput = $('<input class="text_pole" type="text" maxlength="500" placeholder="正则，如：deepseek|grok（留空 = 不自动归类）">').val(draft.matchPattern);
        const includeBodyInput = $('<textarea class="text_pole" rows="4" maxlength="100000" placeholder="YAML，如：top_k: 20\nrepetition_penalty: 1.1"></textarea>').val(draft.customIncludeBody ?? '');
        const excludeBodyInput = $('<textarea class="text_pole" rows="4" maxlength="100000" placeholder="YAML 数组，如：frequency_penalty\npresence_penalty"></textarea>').val(draft.customExcludeBody ?? '');
        const includeHeadersInput = $('<textarea class="text_pole" rows="4" maxlength="100000" placeholder="YAML，如：X-Custom: abc\nAnother-Header: def"></textarea>').val(draft.customIncludeHeaders ?? '');

        const testRow = $('<div class="st-router-key-row"></div>');
        const testInput = $('<input class="text_pole" type="text" maxlength="500" placeholder="输入一个真实模型名测试正则…">');
        const testBtn = $('<button class="menu_button" type="button"><span>测试</span></button>');
        const testResult = $('<span class="st-router-key-col"></span>');
        const runTest = () => {
            const pattern = String(patternInput.val() ?? '').trim();
            const sample = String(testInput.val() ?? '').trim();
            testResult.empty();
            if (!pattern) {
                testResult.text('未填正则，不做自动归类。');
                return;
            }
            try {
                const regex = new RegExp(pattern);
                testResult.text(regex.test(sample) ? `✅ "${sample}" 命中该逻辑模型` : `❌ "${sample}" 未命中`);
            } catch {
                testResult.text('⚠️ 正则语法错误');
            }
        };
        testBtn.on('click', runTest);
        testInput.on('keydown', event => { if (event.key === 'Enter') runTest(); });
        testRow.append(testInput, testBtn, testResult);

        const mappedModelList = $('<div class="st-router-list"></div>');
        const renderMappedModels = () => {
            mappedModelList.empty();
            const names = isNew
                ? []
                : [...new Set(deps.getGroups().flatMap(group => group.entries.flatMap(entry => entry.mappings.filter(mapping => mapping.logicalModelId === draft.id).map(mapping => mapping.realModel))))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
            if (names.length === 0) {
                mappedModelList.append($('<div class="st-router-empty">').text('该逻辑模型名下还没有真实模型。'));
                return;
            }
            const logicalOptionsForMove = () => {
                const options = sortedLogicalModels(deps.getLogicalModels()).filter(model => model.id !== draft.id).map(model => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.name)}</option>`).join('');
                return `<option value="">— 移到… —</option>${options}`;
            };
            for (const realModel of names) {
                const row = $('<div class="st-router-key-row"></div>');
                const name = $('<span class="st-router-key-col">').text(realModel).attr('title', realModel);
                const select = $('<select class="text_pole"></select>').html(logicalOptionsForMove());
                const apply = $('<button class="menu_button" type="button" title="把该真实模型移到所选逻辑模型"><i class="fa-solid fa-arrow-right"></i></button>')
                    .on('click', () => {
                        const targetId = String(select.val() || '');
                        if (!targetId) {
                            toastr.warning('请先选择要移到的逻辑模型。');
                            return;
                        }
                        const touched = assignModelToLogical(deps.getGroups(), realModel, targetId);
                        if (touched > 0) {
                            deps.save();
                            renderModelList();
                            renderGroupSummary();
                            toastr.success(`已将「${realModel}」移到目标逻辑模型（影响 ${touched} 个 Key）。`);
                            renderMappedModels();
                        }
                    });
                row.append(name, select, apply);
                mappedModelList.append(row);
            }
        };
        renderMappedModels();

        const mergeRow = $('<div class="st-router-key-row"></div>');
        const mergeSearch = $('<input class="text_pole" type="text" maxlength="200" placeholder="搜索目标逻辑模型…">');
        const mergeSelect = $('<select class="text_pole"></select>');
        const mergeBtn = $('<button class="menu_button quicker-api__save-button" type="button" title="把本逻辑模型名下全部真实模型合并到所选逻辑模型，并删除本逻辑模型"><i class="fa-solid fa-merge"></i><span>全部合并到…</span></button>');
        const renderMergeOptions = () => {
            const query = String(mergeSearch.val() || '').trim().toLowerCase();
            mergeSelect.empty().append($('<option value="">— 选择目标逻辑模型 —</option>'));
            for (const candidate of sortedLogicalModels(deps.getLogicalModels())) {
                if (candidate.id === draft.id) continue;
                if (query && !String(candidate.name).toLowerCase().includes(query)) continue;
                mergeSelect.append($('<option>').val(candidate.id).text(candidate.name));
            }
        };
        mergeSearch.on('input', renderMergeOptions);
        renderMergeOptions();
        mergeBtn.on('click', () => {
            const targetId = String(mergeSelect.val() || '');
            if (!targetId) {
                toastr.warning('请先选择目标逻辑模型。');
                return;
            }
            const result = mergeLogicalModels(deps.getLogicalModels(), deps.getGroups(), draft.id, targetId);
            if (result.movedMappings > 0 || result.removedLogicalModelId) {
                deps.save();
                renderModelList();
                renderGroupSummary();
                toastr.success(`已将 ${result.movedMappings} 条映射合并到目标逻辑模型，并删除源逻辑模型。`);
                void popup.completeCancelled();
            }
        });
        mergeRow.append(mergeSearch, mergeSelect, mergeBtn);

        content.append(
            field('名称', nameInput, '逻辑模型是你在分组里选的"模型名"；多个 Vendor 的真实模型名可归并到同一个逻辑模型'),
            field('自动归类正则', patternInput, '拉取模型时，真实模型名命中该正则会自动归入此逻辑模型（如 deepseek 会把 deepseek-chat/deepseek-reasoner 归进来）。留空则不参与自动归类'),
            field('自定义 include body（YAML）', includeBodyInput, '路由到该逻辑模型时透传进请求体（仅 custom Vendor 生效）'),
            field('自定义 exclude body（YAML）', excludeBodyInput, '从请求体排除这些参数（仅 custom Vendor 生效）'),
            field('自定义请求头（YAML）', includeHeadersInput, '附加请求头（仅 custom Vendor 生效）'),
            $('<div class="quicker-api__field"></div>').append($('<label><span>测试正则</span></label>'), testRow),
            ...(isNew ? [] : [
                $('<div class="quicker-api__field"></div>').append(
                    $('<label><span>修改映射</span></label>'),
                    $('<div class="st-router-empty">').text('把本逻辑模型名下全部真实模型合并到另一个逻辑模型，合并后本逻辑模型会被删除。'),
                    mergeRow,
                ),
                $('<div class="quicker-api__field"></div>').append(
                    $('<label><span>名下真实模型</span></label>'),
                    mappedModelList,
                ),
            ]),
        );

        const saveBtn = $('<button class="menu_button quicker-api__save-button" type="button"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></button>');
        const cancelBtn = $('<button class="menu_button" type="button"><span>取消</span></button>');
        const actions = $('<div class="st-router-editor-actions"></div>').append(saveBtn, cancelBtn);
        content.append(actions);
        const popup = new Popup(content, POPUP_TYPE.TEXT, '', { large: false, wide: true, okButton: false, cancelButton: false });
        saveBtn.on('click', async () => {
            const name = String(nameInput.val() ?? '').trim().slice(0, 120);
            if (!name) {
                toastr.warning('请填写逻辑模型名称。');
                return;
            }
            const pattern = String(patternInput.val() ?? '').trim().slice(0, 500);
            if (pattern) {
                try {
                    new RegExp(pattern);
                } catch {
                    toastr.warning('正则语法错误，请修正后再保存。');
                    return;
                }
            }
            draft.name = name;
            draft.matchPattern = pattern;
            draft.customIncludeBody = String(includeBodyInput.val() ?? '');
            draft.customExcludeBody = String(excludeBodyInput.val() ?? '');
            draft.customIncludeHeaders = String(includeHeadersInput.val() ?? '');
            const normalized = normalizeLogicalModel(draft);
            if (isNew) {
                deps.getLogicalModels().push(normalized);
            } else if (model) {
                Object.assign(model, normalized);
            }
            deps.save();
            renderModelList();
            renderGroupSummary();
            await popup.completeCancelled();
            toastr.success(`逻辑模型「${name}」已保存。`);
        });
        cancelBtn.on('click', () => void popup.completeCancelled());
        void popup.show();
    }

    panel.find('#st_router_enable').on('change', function () {
        const routing = deps.getRouting();
        routing.enabled = $(this).prop('checked');
        deps.save();
        toastr.info(`路由已${routing.enabled ? '启用' : '停用'}。`);
    });
    panel.find('#st_router_sticky_count').on('change', function () {
        const routing = deps.getRouting();
        routing.stickyCount = Math.max(0, Math.floor(Number($(this).val()) || 0));
        deps.save();
    });
    function applyModelSearch(): void {
        const query = String(panel.find('#st_router_model_search').val() || '').trim().toLowerCase();
        const containers = [logicalList, mappedList, unmappedList];
        for (const container of containers) {
            container.find('[data-search]').each(function () {
                const matches = !query || String($(this).attr('data-search') || '').includes(query);
                $(this).toggle(!query || matches);
            });
            container.find('.st-router-empty').toggle(!query);
        }
    }
    panel.find('#st_router_model_search').on('input', applyModelSearch);
    panel.find('#st_router_group_select').on('change', function () {
        deps.setActiveGroupId(String($(this).val() || ''));
        renderGroupSummary();
        renderProviderList();
        renderModelList();
    });
    panel.find('#st_router_add_group').on('click', async () => {
        const name = await Popup.show.input('新增分组', '');
        if (!name) return;
        const group = normalizeGroup({ name, currentLogicalModelId: sortedLogicalModels(deps.getLogicalModels())[0]?.id || '' });
        deps.getGroups().push(group);
        deps.setActiveGroupId(group.id);
        renderGroupSelect();
        renderGroupSummary();
        renderProviderList();
        renderModelList();
        await openGroupEditor(group);
    });
    panel.find('#st_router_edit_group').on('click', () => {
        const group = activeGroup();
        if (group) void openGroupEditor(group);
    });
    panel.find('#st_router_add_logical').on('click', () => void openLogicalModelEditor(null));
    panel.find('#st_router_refresh_models').on('click', async () => {
        const vendors = deps.getVendors();
        if (vendors.length === 0) {
            toastr.info('还没有 Vendor。先在上方"Vendor"区新增 Vendor，再为其配置 Key 后刷新。');
            return;
        }
        const btn = panel.find('#st_router_refresh_models');
        btn.prop('disabled', true);
        let ok = 0;
        let skipped = 0;
        const failed: string[] = [];
        try {
            const workItems: { vendor: Vendor; entry: GroupEntry }[] = [];
            for (const vendor of vendors) {
                const entries = enabledEntriesForVendor(vendor);
                if (entries.length === 0) {
                    skipped++;
                    continue;
                }
                for (const entry of entries) workItems.push({ vendor, entry });
            }
            for (let index = 0; index < workItems.length; index++) {
                const { vendor, entry } = workItems[index];
                const models = await fetchModelsForVendor(vendor, entry);
                if (models) ok++;
                else failed.push(`${vendor.name} / ${entry.label || 'Key'}`);
                if (index < workItems.length - 1) await jitterDelay();
            }
            renderProviderList();
            renderModelList();
            renderGroupSummary();
            const parts = [`成功 ${ok} 个`];
            if (skipped > 0) parts.push(`无可用 Key 跳过 ${skipped} 个 Vendor`);
            if (failed.length > 0) parts.push(`失败 ${failed.length} 个（${failed.join('、')}）`);
            toastr.success(`模型刷新完成：${parts.join('，')}。`);
        } finally {
            btn.prop('disabled', false);
        }
    });
    panel.find('#st_router_reset_models').on('click', async () => {
        const vendors = deps.getVendors();
        const logicalCount = deps.getLogicalModels().length;
        if (vendors.length === 0 && logicalCount === 0) {
            toastr.info('还没有可重置的数据。');
            return;
        }
        const confirmed = await Popup.show.confirm(
            '重置模型数据',
            `将删除全部逻辑模型（${logicalCount} 个）、所有 Key 的模型映射与已拉取列表，然后重新拉取重建。此操作不可撤销，确定继续？`,
        );
        if (!confirmed) return;
        const btn = panel.find('#st_router_reset_models');
        btn.prop('disabled', true);
        let ok = 0;
        let skipped = 0;
        const failed: string[] = [];
        try {
            const stats = resetModelData(deps.getLogicalModels(), deps.getGroups());
            deps.save();
            renderProviderList();
            renderModelList();
            renderGroupSummary();
            const workItems: { vendor: Vendor; entry: GroupEntry }[] = [];
            for (const vendor of vendors) {
                const entries = enabledEntriesForVendor(vendor);
                if (entries.length === 0) {
                    skipped++;
                    continue;
                }
                for (const entry of entries) workItems.push({ vendor, entry });
            }
            for (let index = 0; index < workItems.length; index++) {
                const { vendor, entry } = workItems[index];
                const models = await fetchModelsForVendor(vendor, entry);
                if (models) ok++;
                else failed.push(`${vendor.name} / ${entry.label || 'Key'}`);
                if (index < workItems.length - 1) await jitterDelay();
            }
            renderProviderList();
            renderModelList();
            renderGroupSummary();
            const parts = [`已删除 ${stats.removedLogicalModels} 个逻辑模型、${stats.removedMappings} 条映射`];
            parts.push(`重新拉取成功 ${ok} 个`);
            if (skipped > 0) parts.push(`无可用 Key 跳过 ${skipped} 个 Vendor`);
            if (failed.length > 0) parts.push(`失败 ${failed.length} 个（${failed.join('、')}）`);
            toastr.success(`模型数据已重置：${parts.join('，')}。`);
        } finally {
            btn.prop('disabled', false);
        }
    });
    // 临时功能：一键清除插件写入的 ST secret，同时清空各 entry 的 secretId 缓存
    panel.find('#st_router_clear_secrets').on('click', async () => {
        const confirmed = await Popup.show.confirm(
            '清除 ST secret',
            '将删除 CUSTOM 与 DEEPSEEK 下所有 label 以「quicker-api:」开头的 secret 条目，各留一个空 active，并清空插件缓存的 secretId。此操作不可撤销，确定继续？',
        );
        if (!confirmed) return;
        const btn = panel.find('#st_router_clear_secrets');
        btn.prop('disabled', true);
        try {
            const { deleted } = await clearQuickApiSecrets();
            for (const group of deps.getGroups()) {
                for (const entry of group.entries) entry.secretId = '';
            }
            deps.save();
            renderProviderList();
            toastr.success(`已清除 ${deleted} 个 quicker-api secret 条目。`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toastr.error(`清除失败：${message}。`);
        } finally {
            btn.prop('disabled', false);
        }
    });
    panel.find('#st_router_build_logical').on('click', () => {
        const allModels: string[] = [];
        for (const group of deps.getGroups()) {
            for (const entry of group.entries) {
                for (const model of entry.fetchedModels) allModels.push(model);
            }
        }
        if (allModels.length === 0) {
            toastr.info('还没有已拉取的模型。先在"当前分组 Key"里点 ↻ 拉取模型，再回来创建逻辑模型。');
            return;
        }
        const { created, skipped, mapped, rebuilt } = buildLogicalModelsFromFetched(allModels, deps.getLogicalModels(), deps.getGroups());
        const pruned = pruneOrphanLogicalModels(deps.getLogicalModels(), deps.getGroups());
        if (created.length === 0 && mapped === 0 && rebuilt === 0 && pruned.length === 0) {
            toastr.info(skipped.length > 0 ? `无新模型可创建（${skipped.length} 个 search/thinking/image 变体已跳过）。` : '逻辑模型已是最新，无需创建。');
            return;
        }
        deps.save();
        renderModelList();
        renderGroupSummary();
        const parts = [`已为 ${created.length} 个真实模型创建独立逻辑模型`];
        if (mapped > 0) parts.push(`自动映射 ${mapped} 条`);
        if (rebuilt > 0) parts.push(`修正归并 ${rebuilt} 条`);
        if (pruned.length > 0) parts.push(`回收孤儿逻辑模型 ${pruned.length} 个`);
        if (skipped.length > 0) parts.push(`跳过 ${skipped.length} 个特殊变体`);
        toastr.success(`${parts.join('，')}。`);
    });
    panel.find('#st_router_export_models').on('click', () => {
        const text = buildModelListText(deps.getGroups());
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `quicker-api-models-${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        const total = text.split('\n').filter(Boolean).length;
        toastr.success(`已导出模型列表：共 ${total} 个模型。`);
    });
    panel.find('#st_router_export_data').on('click', () => {
        const payload = {
            version: 1,
            exportedAt: new Date().toISOString(),
            vendors: deps.getVendors(),
            logicalModels: deps.getLogicalModels(),
            groups: deps.getGroups().map(sanitizeGroupForExport),
            activeGroupId: deps.getActiveGroupId(),
            routing: deps.getRouting(),
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `quicker-api-data-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        toastr.success('已导出完整路由配置 JSON（含 Key，注意保管）。');
    });
    panel.find('#st_router_import_data').on('click', () => {
        const input = $('<input type="file" accept=".json,application/json">');
        input.on('change', async function () {
            const file = (this as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                const importedVendors = Array.isArray(parsed?.vendors) ? parsed.vendors : [];
                const importedLogicalModels = Array.isArray(parsed?.logicalModels) ? parsed.logicalModels : [];
                const importedGroups = Array.isArray(parsed?.groups) ? parsed.groups : [];
                const merged = mergeImportedRoutingConfig({
                    vendors: deps.getVendors(),
                    logicalModels: deps.getLogicalModels(),
                    groups: deps.getGroups(),
                }, {
                    vendors: importedVendors,
                    logicalModels: importedLogicalModels,
                    groups: importedGroups,
                });
                const vendors = deps.getVendors();
                const logicalModels = deps.getLogicalModels();
                const groups = deps.getGroups();
                vendors.splice(0, vendors.length, ...merged.vendors);
                logicalModels.splice(0, logicalModels.length, ...merged.logicalModels);
                groups.splice(0, groups.length, ...merged.groups);
                // 导入文件里的路由设置与当前活动分组一并应用（保留导入快照语义）
                if (parsed?.routing && typeof parsed.routing === 'object') {
                    Object.assign(deps.getRouting(), normalizeRoutingSettings(parsed.routing));
                }
                if (typeof parsed?.activeGroupId === 'string' && groups.some(group => group.id === parsed.activeGroupId)) {
                    deps.setActiveGroupId(parsed.activeGroupId);
                }
                deps.save();
                renderProviderList();
                renderModelList();
                renderGroupSummary();
                renderGroupSelect();
                toastr.success(`已导入配置：Vendor ${merged.vendors.length} 个、逻辑模型 ${merged.logicalModels.length} 个、分组 ${merged.groups.length} 个（按 id 合并）。`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                toastr.error(`导入失败：${message}。`);
            }
        });
        input.trigger('click');
    });
    panel.find('#st_router_add_provider').on('click', async () => {
        const content = $('<div class="st-router-editor"></div>');
        const nameInput = $('<input class="text_pole" type="text" maxlength="120" placeholder="如：硅基流动 / OpenRouter">');
        const endpointInput = $('<input class="text_pole" type="text" maxlength="2048" placeholder="站点 API 地址，如 https://api.example.com/v1">');
        content.append(
            $('<div class="st-router-empty">').text('名称用于在列表中识别该 Vendor，随便起；Endpoint 填站点 API 地址（之后也可在主面板直接改）。'),
            field('名称（识别用）', nameInput),
            field('Endpoint（站点 API 地址）', endpointInput),
        );
        const saveBtn = $('<button class="menu_button quicker-api__save-button" type="button"><i class="fa-solid fa-floppy-disk"></i><span>添加</span></button>');
        const cancelBtn = $('<button class="menu_button" type="button"><span>取消</span></button>');
        const actions = $('<div class="st-router-editor-actions"></div>').append(saveBtn, cancelBtn);
        content.append(actions);
        const popup = new Popup(content, POPUP_TYPE.TEXT, '', { large: false, wide: true, okButton: false, cancelButton: false });
        saveBtn.on('click', async () => {
            const name = String(nameInput.val() ?? '').trim().slice(0, 120);
            if (!name) return toastr.warning('请填写 Vendor 名称。');
            const endpoint = String(endpointInput.val() ?? '').trim().slice(0, 2048);
            const vendor = normalizeVendor({ name, endpoint });
            deps.getVendors().push(vendor);
            deps.save();
            renderProviderList();
            await popup.completeCancelled();
            toastr.success(`Vendor「${name}」已添加。`);
        });
        cancelBtn.on('click', () => void popup.completeCancelled());
        void popup.show();
    });

    // 路由面板为主界面：插到旧版 Profile 区之前；旧版区默认折叠（保留功能，快捷方案仍引用 profiles）
    panel.insertBefore('#quicker_api');
    let legacyVisible = false;
    $('#quicker_api').hide();
    panel.find('#st_router_export_log').on('click', () => {
        exportDebugLog();
    });
    panel.find('#st_router_toggle_legacy').on('click', function () {
        legacyVisible = !legacyVisible;
        $('#quicker_api').toggle(legacyVisible);
        $(this).toggleClass('active', legacyVisible);
    });
    renderRoutingControls();
    renderGroupSelect();
    renderProviderList();
    renderModelList();

    // 打开面板/刷新后：若上次已选择逻辑模型，恢复 ST 已启用状态
    const initialGroup = activeGroup();
    if (initialGroup?.currentLogicalModelId && deps.getLogicalModels().some(model => model.id === initialGroup.currentLogicalModelId)) {
        setOnlineStatus('已启用');
    }

    // 便捷方案切换逻辑模型后刷新模型列表高亮
    const onLogicalModelChanged = () => renderModelList();
    $(document).on('quickerApi:logical-model-changed', onLogicalModelChanged);
    panel.on('remove', () => $(document).off('quickerApi:logical-model-changed', onLogicalModelChanged));

    // 更多菜单下拉
    panel.find('#st_router_more').on('click', (e) => {
        e.stopPropagation();
        panel.find('#st_router_more_menu').toggle();
    });
    $(document).on('click', (e) => {
        if (!$(e.target).closest('#st_router_more, #st_router_more_menu').length) {
            panel.find('#st_router_more_menu').hide();
        }
    });

    return { panel, render: () => { renderRoutingControls(); renderGroupSelect(); renderProviderList(); renderModelList(); } };
}
