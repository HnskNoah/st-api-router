// Vendor / LogicalModel / Group 管理面板。
// deps 由 lifecycle 注入，避免循环 import。
// 模型获取复用宿主后端通道（/api/backends/chat-completions/status），并把结果落到 vendor.fetchedModels。

import { getRequestHeaders } from '@sillytavern/script';
import { SECRET_KEYS, writeSecret } from '@sillytavern/scripts/secrets';
import { POPUP_TYPE, Popup } from '@sillytavern/scripts/popup';
import { escapeHtml } from '../utils/text.js';
import { makeId } from '../utils/id.js';
import {
    assignRealModel,
    normalizeGroup,
    normalizeLogicalModel,
    normalizeVendor,
    pruneOrphanLogicalModels,
    reconcileVendorMappings,
} from '../domain/vendor.js';
import { ensureEmptySecret, readAuthoritativeSecretState, rotateSecretVerified } from '../secrets/api.js';
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

            /* ── Vendor 行 ── */
            .st-router-provider {
                display: flex; align-items: center; gap: 8px; padding: 8px 0;
                border-bottom: 1px solid rgba(255, 255, 255, 0.07); flex-wrap: wrap;
            }
            .st-router-provider:last-child { border-bottom: none; }
            .st-router-provider-info { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
            .st-router-provider-name { flex: none; font-weight: 600; white-space: nowrap; }
            .st-router-provider-endpoint {
                width: 180px; max-width: 55%; flex: none; margin: 0;
            }
            .st-router-provider-meta { flex-basis: 100%; font-size: 12px; color: #999; opacity: 0.9; }
            .st-router-provider-actions { flex: none; display: flex; gap: 4px; }

            /* ── 状态徽章 ── */
            .st-router-badge {
                flex: none; font-size: 11px; padding: 2px 8px; border-radius: 10px;
                border: 1px solid rgba(128, 128, 128, 0.4); color: #aaa;
            }
            .st-router-badge--ok { color: #7ecf8a; border-color: rgba(126, 207, 138, 0.5); }
            .st-router-badge--disabled { color: #e08a8a; border-color: rgba(224, 138, 138, 0.5); }
            .st-router-badge--rpm { color: #e0c07e; border-color: rgba(224, 192, 126, 0.5); }

            /* ── Key 条目表 ── */
            .st-router-key-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; flex-wrap: wrap; }
            .st-router-key-row--header { font-size: 12px; color: #999; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
            .st-router-key-row > select.text_pole { width: auto; flex: 1 1 130px; min-width: 100px; margin: 0; }
            .st-router-key-row > input[type="password"] { width: auto; flex: 2 1 180px; min-width: 140px; margin: 0; }
            .st-router-key-row > input[type="text"] { width: auto; flex: 1 1 90px; min-width: 70px; margin: 0; }
            .st-router-key-row > input[type="checkbox"] { flex: none; }
            .st-router-key-row > .menu_button { flex: none; }
            .st-router-key-col { flex: 1 1 0; min-width: 0; font-size: 12px; color: #999; }

            /* ── 逻辑模型 chips ── */
            .st-router-model-list { display: flex; flex-wrap: wrap; gap: 8px; }
            .st-router-model-chip {
                display: inline-flex; align-items: center; gap: 8px;
                border: 1px solid rgba(128, 128, 128, 0.35); border-radius: 16px;
                padding: 4px 12px; cursor: pointer; background: rgba(255, 255, 255, 0.04);
                color: inherit; font-size: 13px; transition: border-color 0.15s, background 0.15s;
            }
            .st-router-model-chip:hover { border-color: #5b9bd5; }
            .st-router-model-chip.is-selected {
                border-color: #5b9bd5; background: rgba(91, 155, 213, 0.18);
            }
            .st-router-model-name { font-weight: 600; }
            .st-router-model-providers { font-size: 11px; color: #999; }
            .st-router-model-edit {
                font-size: 11px; color: #999; cursor: pointer; padding: 0 2px;
                border-radius: 4px; display: inline-flex; align-items: center;
            }
            .st-router-model-edit:hover { color: #5b9bd5; background: rgba(91, 155, 213, 0.15); }

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
                <span><i class="fa-solid fa-route"></i> 供应商路由</span>
                <span class="st-router-title-actions">
                    <button id="st_router_toggle_legacy" class="menu_button" type="button" title="旧版 API Profile 设置（过渡兼容）"><i class="fa-solid fa-clock-rotate-left"></i><span>旧版设置</span></button>
                </span>
            </div>

            <div class="st-router-section st-router-section--master">
                <label class="checkbox_label st-router-master-toggle" for="st_router_enable"><input id="st_router_enable" type="checkbox" /> 启用路由</label>
                <div class="st-router-master-row">
                    <label for="st_router_sticky_seconds">保持同一 Vendor：</label>
                    <input id="st_router_sticky_seconds" class="text_pole st-router-sticky-input" type="number" min="0" step="1" />
                    <span>秒（0 = 每次生成都重新随机）</span>
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
                    <span class="st-router-step-badge">3</span><span class="st-router-section-title">当前分组 Key</span>
                    <div class="st-router-section-tools">
                        <button id="st_router_add_entry" class="menu_button" type="button"><i class="fa-solid fa-plus"></i><span>添加 Key</span></button>
                    </div>
                </div>
                <div id="st_router_group_entries" class="st-router-list"></div>
            </div>

            <div class="st-router-section">
                <div class="st-router-section-head">
                    <span class="st-router-step-badge">4</span><span class="st-router-section-title">逻辑模型</span>
                    <div class="st-router-section-tools">
                        <button id="st_router_add_logical" class="menu_button" type="button" title="手动添加逻辑模型（可填自动归类正则）"><i class="fa-solid fa-plus"></i><span>添加逻辑模型</span></button>
                    </div>
                </div>
                <div id="st_router_model_list" class="st-router-model-list"></div>
            </div>
        </section>
    `);

    const providerList = panel.find('#st_router_provider_list');
    const modelList = panel.find('#st_router_model_list');
    const groupSummary = panel.find('#st_router_group_summary');

    function renderRoutingControls(): void {
        const routing = deps.getRouting();
        panel.find('#st_router_enable').prop('checked', routing.enabled);
        panel.find('#st_router_sticky_seconds').val(Number(routing.stickySeconds) || 0);
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

    const groupEntriesList = panel.find('#st_router_group_entries');

    function renderGroupEntries(): void {
        const group = activeGroup();
        groupEntriesList.empty();
        if (!group) {
            groupEntriesList.append($('<div class="st-router-empty">').text('还没有分组。先新增分组，再为它配置 Vendor + Key。'));
            return;
        }
        if (deps.getVendors().length === 0) {
            groupEntriesList.append($('<div class="st-router-empty">').text('先在上方"Vendor"区新增 Vendor，再为该分组添加 Key。'));
            return;
        }
        const header = $('<div class="st-router-key-row st-router-key-row--header"></div>');
        header.append(
            $('<span class="st-router-key-col">').text('Vendor'),
            $('<span class="st-router-key-col" style="flex:2 1 0;">').text('Key'),
            $('<span class="st-router-key-col">').text('名称'),
            $('<span class="st-router-key-col" style="flex:0 0 30px;">').text('启用'),
            $('<span class="st-router-key-col" style="flex:0 0 26px;">').text('拉取'),
            $('<span class="st-router-key-col" style="flex:0 0 26px;">'),
        );
        groupEntriesList.append(header);
        if (group.entries.length === 0) {
            groupEntriesList.append($('<div class="st-router-empty">').text('该分组还没有 Key。点击右上角"添加 Key"，选 Vendor、填真实 Key 后点 ↻ 拉取模型。'));
            return;
        }
        for (const entry of group.entries) {
            const row = $('<div class="st-router-key-row"></div>');
            const vendorSelect = $('<select class="text_pole" title="Vendor"></select>');
            for (const vendor of deps.getVendors()) {
                vendorSelect.append($('<option>').val(vendor.id).text(vendor.name));
            }
            vendorSelect.val(entry.vendorId || '');
            if (!entry.vendorId || !deps.getVendors().some(vendor => vendor.id === entry.vendorId)) {
                vendorSelect.prepend($('<option value="">— 选择 Vendor —</option>'));
                vendorSelect.val(entry.vendorId || '');
            }
            vendorSelect.on('change', function () {
                entry.vendorId = String($(this).val() || '');
                deps.save();
            });
            const keyInput = $('<input class="text_pole" type="password" maxlength="2048" autocomplete="off" placeholder="Key">')
                .val(entry.apiKey || '')
                .on('input', function () {
                    entry.apiKey = String($(this).val() ?? '').trim();
                    deps.save();
                });
            const labelInput = $('<input class="text_pole" type="text" maxlength="120" placeholder="名称，如：主号 / 备用">')
                .val(entry.label || '')
                .on('input', function () {
                    entry.label = String($(this).val() ?? '').trim() || 'Key';
                    deps.save();
                });
            const enabled = $('<input type="checkbox" title="启用该 Key">').prop('checked', entry.enabled)
                .on('change', function () {
                    entry.enabled = $(this).prop('checked');
                    deps.save();
                });
            const fetchBtn = $('<button class="menu_button" type="button" title="用该 Vendor 的 Key 拉取模型并自动映射"><i class="fa-solid fa-arrows-rotate"></i></button>')
                .on('click', async () => {
                    const vendor = deps.getVendors().find(item => item.id === entry.vendorId);
                    if (!vendor) {
                        toastr.warning('请先为该条目选择 Vendor。');
                        return;
                    }
                    const key = String(entry.apiKey || '').trim();
                    if (!key) {
                        toastr.warning(`请先填写 Vendor「${vendor.name}」的 Key 再拉取。`);
                        return;
                    }
                    const models = await fetchModelsForVendor(vendor, key);
                    if (!models) return;
                    renderProviderList();
                    renderGroupEntries();
                    renderModelList();
                    toastr.success(`Vendor「${vendor.name}」获取 ${models.length} 个模型并已映射。`);
                });
            const removeBtn = $('<button class="menu_button quicker-api__delete-button" type="button" title="删除条目"><i class="fa-solid fa-trash"></i></button>')
                .on('click', () => {
                    group.entries = group.entries.filter(item => item.id !== entry.id);
                    deps.save();
                    renderGroupEntries();
                    renderGroupSummary();
                });
            row.append(vendorSelect, keyInput, labelInput, enabled, fetchBtn, removeBtn);
            groupEntriesList.append(row);
        }
    }

    function renderModelList(): void {
        const group = activeGroup();
        const models = deps.getLogicalModels();
        const vendors = deps.getVendors();
        modelList.empty();
        if (models.length === 0) {
            modelList.append($('<div class="st-router-empty">').text('还没有逻辑模型。可在下方"当前分组 Key"填 Key 后点 ↻ 拉取自动生成，或点击右上角"添加逻辑模型"手动创建。'));
            return;
        }
        for (const model of models) {
            const chip = $('<button class="st-router-model-chip" type="button"></button>')
                .append($('<span class="st-router-model-name">').text(model.name));
            const mappedVendors = vendors.filter(vendor => vendor.mappings.some(mapping => mapping.logicalModelId === model.id));
            const mappedCount = mappedVendors.reduce((sum, vendor) => sum + vendor.mappings.filter(mapping => mapping.logicalModelId === model.id).length, 0);
            chip.append($('<span class="st-router-model-providers">').text(
                model.matchPattern ? `正则匹配 ${mappedCount} 个模型 · ${mappedVendors.length} 个 Vendor` : `${mappedCount} 个模型 · ${mappedVendors.length} 个 Vendor`,
            ));
            if (group?.currentLogicalModelId === model.id) chip.addClass('is-selected');
            chip.attr('title', group ? '点击设为当前分组的逻辑模型' : '');
            chip.on('click', () => {
                if (!group) return;
                group.currentLogicalModelId = model.id;
                deps.save();
                renderModelList();
                renderGroupSummary();
            });
            const editBtn = $('<span class="st-router-model-edit" role="button" tabindex="0" title="编辑正则与名称"><i class="fa-solid fa-sliders"></i></span>')
                .on('click', event => {
                    event.stopPropagation();
                    void openLogicalModelEditor(model);
                });
            chip.append(editBtn);
            modelList.append(chip);
        }
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
        providerList.empty();
        if (vendors.length === 0) {
            providerList.append($('<div class="st-router-empty">').text('还没有 Vendor。点击右上角"新增 Vendor"，填名称与站点地址（Endpoint）。'));
            return;
        }
        for (const vendor of vendors) {
            const row = $('<div class="st-router-provider"></div>');
            const enabledCheck = $('<label class="checkbox_label" title="启用/禁用 Vendor"><input type="checkbox" class="st-router-provider-enabled"></label>');
            enabledCheck.find('input').prop('checked', vendor.enabled).on('change', function () {
                vendor.enabled = $(this).prop('checked');
                if (vendor.enabled) vendor.disabledReason = '';
                deps.save();
                renderProviderList();
                renderModelList();
            });
            row.append(enabledCheck);
            const info = $('<div class="st-router-provider-info st-router-provider-info--editable"></div>');
            info.append($('<span class="st-router-provider-name">').text(vendor.name));
            const endpointInput = $('<input class="text_pole st-router-provider-endpoint" type="text" maxlength="2048" placeholder="站点地址，如 https://api.example.com/v1">')
                .val(vendor.endpoint || '')
                .on('input', function () {
                    vendor.endpoint = String($(this).val() ?? '').trim();
                    deps.save();
                });
            info.append(endpointInput);
            info.append($('<span class="st-router-provider-meta">').text(
                `${FORMAT_LABELS[vendor.format] ?? vendor.format} · rpm ${vendor.rpm === 0 ? '∞' : vendor.rpm} · 上下文 ${vendor.maxContext || '不限制'} · 已拉取 ${vendor.fetchedModels.length} 个模型 · 成功率 ${successRateText(vendor)}`,
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
                    for (const group of deps.getGroups()) group.entries = group.entries.filter(entry => entry.vendorId !== vendor.id);
                    deps.save();
                    renderProviderList();
                    renderGroupEntries();
                    renderModelList();
                    renderGroupSummary();
                });
            const actions = $('<div class="st-router-provider-actions"></div>');
            actions.append(editBtn, deleteBtn);
            row.append(actions);
            providerList.append(row);
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

    async function fetchModelsForVendor(vendor: Vendor, key: string): Promise<string[] | null> {
        const isDeepseek = vendor.format === 'deepseek';
        const secretKey = isDeepseek ? SECRET_KEYS.DEEPSEEK : SECRET_KEYS.CUSTOM;
        let previousActiveId = '';
        try {
            const authoritative = await readAuthoritativeSecretState();
            previousActiveId = String((authoritative?.[secretKey] || []).find((entry: any) => entry.active)?.id || '');
            let secretId: string | null = null;
            if (key) {
                secretId = await writeSecret(secretKey, key, `quicker-api:${vendor.name}`);
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
            vendor.fetchedModels = models;
            for (const model of models) {
                const logical = assignRealModel(deps.getLogicalModels(), model);
                if (!vendor.mappings.some(mapping => mapping.realModel === model)) {
                    vendor.mappings.push({ id: makeId('mapping'), realModel: model, logicalModelId: logical.id });
                }
            }
            // 以最新拉取结果为权威：清除该 Vendor 不再存在的真实模型映射，并回收孤儿逻辑模型
            reconcileVendorMappings(vendor, models);
            pruneOrphanLogicalModels(deps.getLogicalModels(), deps.getVendors());
            deps.save();
            return models;
        } catch (error) {
            console.error('[QuickerApi] fetch vendor models failed:', error);
            const message = error instanceof Error ? error.message : String(error);
            toastr.error(`Vendor「${vendor.name}」获取模型失败：${message}。`);
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

    function firstKeyForVendor(vendor: Vendor): string {
        for (const group of deps.getGroups()) {
            const entry = group.entries.find(item => item.vendorId === vendor.id && item.apiKey);
            if (entry) return entry.apiKey;
        }
        return '';
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
        const weightInput = $('<input class="text_pole" type="number" min="0" step="1">').val(draft.weight);
        const enabledCheck = $('<input type="checkbox">').prop('checked', draft.enabled);

        const mappingList = $('<div class="st-router-list"></div>');
        const logicalOptions = () => {
            const options = deps.getLogicalModels().map(model => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.name)}</option>`).join('');
            return `<option value="">— 选择逻辑模型 —</option>${options}`;
        };
        const renderMappings = () => {
            mappingList.empty();
            for (const mapping of draft.mappings) {
                const row = $('<div class="st-router-key-row"></div>');
                const realInput = $('<input class="text_pole" type="text" maxlength="500">').val(mapping.realModel);
                const logicalSelect = $('<select class="text_pole"></select>').html(logicalOptions()).val(mapping.logicalModelId);
                realInput.on('input', function () { mapping.realModel = String($(this).val() ?? '').trim(); });
                logicalSelect.on('change', function () { mapping.logicalModelId = String($(this).val() || ''); });
                const removeBtn = $('<button class="menu_button quicker-api__delete-button" type="button" title="删除映射"><i class="fa-solid fa-trash"></i></button>')
                    .on('click', () => {
                        draft.mappings = draft.mappings.filter(item => item.id !== mapping.id);
                        renderMappings();
                    });
                row.append(realInput, logicalSelect, removeBtn);
                mappingList.append(row);
            }
        };
        renderMappings();

        const addMappingBtn = $('<button class="menu_button st-router-add" type="button"><i class="fa-solid fa-plus"></i><span>添加映射</span></button>')
            .on('click', () => {
                draft.mappings.push({ id: makeId('mapping'), realModel: '', logicalModelId: '' });
                renderMappings();
            });
        const fetchBtn = $('<button class="menu_button" type="button"><i class="fa-solid fa-arrows-rotate"></i><span>拉取模型并自动映射</span></button>')
            .on('click', async () => {
                draft.endpoint = String(endpointInput.val() ?? '').trim();
                draft.format = String(formatSelect.val() || 'custom') as Vendor['format'];
                const realKey = firstKeyForVendor(draft);
                if (!realKey) {
                    toastr.warning('该 Vendor 尚未配置 Key：请先在上方分组条目中填写该 Vendor 的真实 Key。');
                    return;
                }
                const models = await fetchModelsForVendor(draft, realKey);
                if (!models) return;
                renderMappings();
                toastr.success(`Vendor「${draft.name}」获取 ${models.length} 个模型。`);
            });

        content.append(
            field('名称', nameInput, '列表里用于识别，不会发给站点'),
            field('格式', formatSelect, '决定请求协议：Custom 走 OpenAI 兼容接口；DeepSeek 走 ST 原生 DeepSeek 源'),
            field('Endpoint', endpointInput, '站点 API 地址。custom 系列填 Base URL（如 https://api.xxx.com/v1）；deepseek 填反代地址'),
            field('RPM 上限（0 = 不限）', rpmInput, '该 Vendor 每分钟最多请求次数，所有分组共享此限制'),
            field('最大上下文（0 = 不限制）', contextInput, '路由到该 Vendor 时，SillyTavern 的上下文上限会被钳制到不超过这个值（防止超出站点上下文）'),
            field('权重', weightInput, '选路权重：数值越大越容易被随机选中（实际概率还会叠加历史成功率加成）'),
            $('<label class="checkbox_label st-router-editor-enabled"></label>').append(enabledCheck, ' 启用（参与路由）'),
            field('模型映射', $('<div></div>').append(
                $('<div class="st-router-empty">').text('点击下方按钮，用分组条目里该 Vendor 的真实 Key 拉取模型并自动建立映射。'),
                mappingList,
                addMappingBtn,
                fetchBtn,
            ), '把该 Vendor 的真实模型名（如 [希希2]grok-4.5）归并到你选定的逻辑模型；多个 Vendor 可映射到同一个逻辑模型'),
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
        for (const model of deps.getLogicalModels()) logicalSelect.append($('<option>').val(model.id).text(model.name));
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
                keyInput.on('input', function () { entry.apiKey = String($(this).val() ?? '').trim(); });
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
                draft.entries.push({ id: makeId('group-entry'), vendorId: '', apiKey: '', label: 'Key', enabled: true });
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

        const mappingCount = isNew ? null : deps.getVendors().reduce((sum, vendor) => sum + vendor.mappings.filter(mapping => mapping.logicalModelId === draft.id).length, 0);

        content.append(
            field('名称', nameInput, '逻辑模型是你在分组里选的"模型名"；多个 Vendor 的真实模型名可归并到同一个逻辑模型'),
            field('自动归类正则', patternInput, '拉取模型时，真实模型名命中该正则会自动归入此逻辑模型（如 deepseek 会把 deepseek-chat/deepseek-reasoner 归进来）。留空则不参与自动归类'),
            $('<div class="quicker-api__field"></div>').append($('<label><span>测试正则</span></label>'), testRow),
            ...(isNew || mappingCount === null ? [] : [$('<div class="quicker-api__status">').text(`当前已有 ${mappingCount} 个真实模型名映射到该逻辑模型。`)]),
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
    panel.find('#st_router_sticky_seconds').on('change', function () {
        const routing = deps.getRouting();
        routing.stickySeconds = Math.max(0, Math.floor(Number($(this).val()) || 0));
        deps.save();
    });
    panel.find('#st_router_group_select').on('change', function () {
        deps.setActiveGroupId(String($(this).val() || ''));
        renderGroupSummary();
        renderGroupEntries();
        renderModelList();
    });
    panel.find('#st_router_add_group').on('click', async () => {
        const name = await Popup.show.input('新增分组', '');
        if (!name) return;
        const group = normalizeGroup({ name, currentLogicalModelId: deps.getLogicalModels()[0]?.id || '' });
        deps.getGroups().push(group);
        deps.setActiveGroupId(group.id);
        renderGroupSelect();
        renderGroupSummary();
        renderGroupEntries();
        renderModelList();
        await openGroupEditor(group);
    });
    panel.find('#st_router_edit_group').on('click', () => {
        const group = activeGroup();
        if (group) void openGroupEditor(group);
    });
    panel.find('#st_router_add_logical').on('click', () => void openLogicalModelEditor(null));
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
            renderGroupEntries();
            await popup.completeCancelled();
            toastr.success(`Vendor「${name}」已添加。`);
        });
        cancelBtn.on('click', () => void popup.completeCancelled());
        void popup.show();
    });
    panel.find('#st_router_add_entry').on('click', () => {
        const group = activeGroup();
        if (!group) {
            toastr.warning('请先新增分组。');
            return;
        }
        if (deps.getVendors().length === 0) {
            toastr.warning('请先新增 Vendor。');
            return;
        }
        group.entries.push({ id: makeId('group-entry'), vendorId: deps.getVendors()[0].id, apiKey: '', label: 'Key', enabled: true });
        deps.save();
        renderGroupEntries();
        renderGroupSummary();
    });

    // 路由面板为主界面：插到旧版 Profile 区之前；旧版区默认折叠（保留功能，快捷方案仍引用 profiles）
    panel.insertBefore('#quicker_api');
    let legacyVisible = false;
    $('#quicker_api').hide();
    panel.find('#st_router_toggle_legacy').on('click', function () {
        legacyVisible = !legacyVisible;
        $('#quicker_api').toggle(legacyVisible);
        $(this).toggleClass('active', legacyVisible);
    });
    renderRoutingControls();
    renderGroupSelect();
    renderProviderList();
    renderGroupEntries();
    renderModelList();

    // 便捷方案切换逻辑模型后刷新模型列表高亮
    const onLogicalModelChanged = () => renderModelList();
    $(document).on('quickerApi:logical-model-changed', onLogicalModelChanged);
    panel.on('remove', () => $(document).off('quickerApi:logical-model-changed', onLogicalModelChanged));

    return { panel, render: () => { renderRoutingControls(); renderGroupSelect(); renderProviderList(); renderGroupEntries(); renderModelList(); } };
}
