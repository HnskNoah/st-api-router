// Vendor / LogicalModel / Group 管理面板。
// deps 由 lifecycle 注入，避免循环 import。
// 模型获取复用宿主后端通道（/api/backends/chat-completions/status），并把结果落到 vendor.fetchedModels。

import { getRequestHeaders } from '@sillytavern/script';
import { SECRET_KEYS, writeSecret } from '@sillytavern/scripts/secrets';
import { Popup } from '@sillytavern/scripts/popup';
import { escapeHtml } from '../utils/text.js';
import { makeId } from '../utils/id.js';
import {
    normalizeGroup,
    normalizeLogicalModel,
    normalizeVendor,
} from '../domain/vendor.js';
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

const FORMAT_LABELS: Record<string, string> = { 'custom': 'OpenAI 兼容', 'custom-responses': 'OpenAI Responses', 'deepseek': 'DeepSeek' };

function statusBadge(reason: string | null): string {
    const label: Record<string, string> = { disabled: '禁用', rpm: '限流' };
    return `<span class="st-router-badge st-router-badge--${reason ?? 'ok'}">${reason ? (label[reason] ?? reason) : '可用'}</span>`;
}

function ensureLogicalModel(logicalModels: LogicalModel[], name: string): LogicalModel {
    const existing = logicalModels.find(model => model.name === name);
    if (existing) return existing;
    const model = normalizeLogicalModel({ name });
    logicalModels.push(model);
    return model;
}

export function initRoutingUI(deps: RoutingUIDeps): { panel: JQuery<HTMLElement>; render(): void } {
    const panel = $(`
        <section id="st_router_panel" class="quicker-api">
            <div class="quicker-api__title">
                <span><i class="fa-solid fa-route"></i> 供应商路由 / Vendor Routing</span>
                <span class="st-router-title-actions">
                    <button id="st_router_toggle_legacy" class="menu_button" type="button" title="旧版 API Profile 设置（过渡兼容）"><i class="fa-solid fa-clock-rotate-left"></i><span>旧版设置</span></button>
                    <span title="Group 选择逻辑模型；生成时按成功率从可用 Vendor 中随机路由"><i class="fa-solid fa-circle-info"></i></span>
                </span>
            </div>
            <div class="quicker-api__field">
                <div class="st-router-controls">
                    <label class="checkbox_label" for="st_router_enable"><input id="st_router_enable" type="checkbox" /> 启用路由</label>
                    <label for="st_router_sticky_seconds" class="st-router-strategy-label">固定时长（秒，0 = 每次随机）</label>
                    <input id="st_router_sticky_seconds" class="text_pole st-router-strategy" type="number" min="0" step="1" />
                </div>
            </div>
            <div class="quicker-api__field">
                <label for="st_router_group_select">功能分组</label>
                <div class="st-router-controls">
                    <select id="st_router_group_select" class="text_pole st-router-strategy"></select>
                    <button id="st_router_add_group" class="menu_button" type="button"><i class="fa-solid fa-plus"></i><span>新增 Group</span></button>
                    <button id="st_router_edit_group" class="menu_button" type="button" title="编辑 Group 名称与逻辑模型"><i class="fa-solid fa-pen"></i><span>编辑 Group</span></button>
                </div>
            </div>
            <div class="quicker-api__field">
                <label>Vendor（模型商）与 Key 条目</label>
                <div class="quicker-api__status">每个 Vendor 填 endpoint；每个条目选 Vendor 并填对应 Key（同一 Vendor 可多 Key）。</div>
                <div id="st_router_provider_list" class="st-router-list"></div>
                <button id="st_router_add_provider" class="menu_button st-router-add" type="button"><i class="fa-solid fa-plus"></i><span>新增 Vendor</span></button>
                <div class="quicker-api__field-inline-label">当前 Group 条目</div>
                <div id="st_router_group_entries" class="st-router-list"></div>
                <button id="st_router_add_entry" class="menu_button st-router-add" type="button"><i class="fa-solid fa-plus"></i><span>添加 Vendor + Key</span></button>
            </div>
            <div class="quicker-api__field">
                <label>逻辑模型</label>
                <div id="st_router_model_list" class="st-router-model-list"></div>
            </div>
        </section>
    `);

    const providerList = panel.find('#st_router_provider_list');
    const modelList = panel.find('#st_router_model_list');

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
            groupEntriesList.append($('<div class="quicker-api__status">').text('还没有 Group。先新增 Group。'));
            return;
        }
        if (deps.getVendors().length === 0) {
            groupEntriesList.append($('<div class="quicker-api__status">').text('先新增 Vendor，再为 Group 添加 Vendor + Key 条目。'));
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
            const keyInput = $('<input class="text_pole" type="password" maxlength="2048" autocomplete="off" placeholder="API Key">')
                .val(entry.apiKey || '')
                .on('input', function () {
                    entry.apiKey = String($(this).val() ?? '').trim();
                    deps.save();
                });
            const labelInput = $('<input class="text_pole" type="text" maxlength="120" placeholder="Key 名称">')
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
            const removeBtn = $('<button class="menu_button quicker-api__delete-button" type="button" title="删除条目"><i class="fa-solid fa-trash"></i></button>')
                .on('click', () => {
                    group.entries = group.entries.filter(item => item.id !== entry.id);
                    deps.save();
                    renderGroupEntries();
                });
            row.append(vendorSelect, keyInput, labelInput, enabled, removeBtn);
            groupEntriesList.append(row);
        }
    }

    function renderModelList(): void {
        const group = activeGroup();
        const models = deps.getLogicalModels();
        modelList.empty();
        if (models.length === 0) {
            modelList.append($('<div class="quicker-api__status">').text('还没有逻辑模型。在 Vendor 中拉取模型并建立映射后即可出现。'));
            return;
        }
        for (const model of models) {
            const chip = $('<button class="st-router-model-chip" type="button"></button>')
                .append($('<span class="st-router-model-name">').text(model.name));
            const vendorCount = deps.getVendors().filter(vendor => vendor.mappings.some(mapping => mapping.logicalModelId === model.id)).length;
            chip.append($('<span class="st-router-model-providers">').text(`${vendorCount} 个 Vendor`));
            if (group?.currentLogicalModelId === model.id) chip.addClass('is-selected');
            chip.attr('title', group ? '点击设为当前 Group 的逻辑模型' : '');
            chip.on('click', () => {
                if (!group) return;
                group.currentLogicalModelId = model.id;
                deps.save();
                renderModelList();
            });
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
            providerList.append($('<div class="quicker-api__status">').text('还没有 Vendor。点击"新增 Vendor"，填写名称与 endpoint 后即可添加 Key。'));
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
            const endpointInput = $('<input class="text_pole st-router-provider-endpoint" type="text" maxlength="2048" placeholder="Endpoint（custom 填 Base URL；deepseek 填反代地址）">')
                .val(vendor.endpoint || '')
                .on('input', function () {
                    vendor.endpoint = String($(this).val() ?? '').trim();
                    deps.save();
                });
            info.append(endpointInput);
            info.append($('<span class="st-router-provider-meta">').text(
                `${FORMAT_LABELS[vendor.format] ?? vendor.format} · rpm ${vendor.rpm === 0 ? '∞' : vendor.rpm} · context ${vendor.maxContext || '未限制'} · 模型 ${vendor.fetchedModels.length} · 成功率 ${successRateText(vendor)}`,
            ));
            if (vendor.disabledReason) info.append($('<span class="st-router-provider-meta">').text(vendor.disabledReason));
            row.append(info);
            row.append(statusBadge(vendorStatus(vendor)));
            const editBtn = $('<button class="menu_button" type="button" title="编辑（格式/RPM/上下文/映射）"><i class="fa-solid fa-pen"></i></button>')
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

    function field(labelText: string, control: JQuery<HTMLElement>): JQuery<HTMLElement> {
        return $('<div class="quicker-api__field"></div>').append($('<label>').text(labelText), control);
    }

    async function fetchModelsForVendor(vendor: Vendor, key: string): Promise<string[] | null> {
        const isDeepseek = vendor.format === 'deepseek';
        const secretKey = isDeepseek ? SECRET_KEYS.DEEPSEEK : SECRET_KEYS.CUSTOM;
        try {
            let secretId: string | null = null;
            if (key) {
                secretId = await writeSecret(secretKey, key, `quicker-api:${vendor.name}`);
            }
            const statusBody: Record<string, any> = {
                chat_completion_source: isDeepseek ? 'deepseek' : 'custom',
                custom_api_format: vendor.format === 'custom-responses' ? 'openai_responses' : 'openai_compat',
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
                const logical = ensureLogicalModel(deps.getLogicalModels(), model);
                if (!vendor.mappings.some(mapping => mapping.realModel === model)) {
                    vendor.mappings.push({ id: makeId('mapping'), realModel: model, logicalModelId: logical.id });
                }
            }
            deps.save();
            return models;
        } catch (error) {
            console.error('[QuickerApi] fetch vendor models failed:', error);
            const message = error instanceof Error ? error.message : String(error);
            toastr.error(`Vendor「${vendor.name}」获取模型失败：${message}。`);
            return null;
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
        const nameInput = $('<input class="text_pole" type="text" maxlength="120">').val(draft.name);
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
        const keyInput = $('<input class="text_pole" type="password" autocomplete="off" placeholder="拉取模型用 Key（不强制保存）">').val(firstKeyForVendor(draft));

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
                const models = await fetchModelsForVendor(draft, String(keyInput.val() ?? '').trim());
                if (!models) return;
                renderMappings();
                toastr.success(`Vendor「${draft.name}」获取 ${models.length} 个模型。`);
            });

        content.append(
            field('名称', nameInput),
            field('格式', formatSelect),
            field('Endpoint', endpointInput),
            field('RPM 上限（0 = 不限）', rpmInput),
            field('Context 上限（0 = 不限制）', contextInput),
            field('权重', weightInput),
            field('拉取模型用 Key', keyInput),
            $('<label class="checkbox_label st-router-editor-enabled"></label>').append(enabledCheck, ' 启用'),
            field('模型映射', $('<div></div>').append(mappingList, addMappingBtn)),
        );
        content.append(fetchBtn);

        const saveBtn = $('<button class="menu_button quicker-api__save-button" type="button"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></button>');
        const cancelBtn = $('<button class="menu_button" type="button"><span>取消</span></button>');
        const actions = $('<div class="st-router-editor-actions"></div>').append(saveBtn, cancelBtn);
        content.append(actions);
        const popup = new Popup(content, 'text', '', { large: false, wide: true, okButton: false, cancelButton: false });
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
        const nameInput = $('<input class="text_pole" type="text" maxlength="120">').val(draft.name);
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
                const labelInput = $('<input class="text_pole" type="text" maxlength="120" placeholder="Key 名称">').val(entry.label);
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
            field('名称', nameInput),
            field('当前逻辑模型', logicalSelect),
            $('<label class="checkbox_label st-router-editor-enabled"></label>').append(enabledCheck, ' 启用'),
            field('Vendor + Key 条目', $('<div></div>').append(entryList, addEntryBtn)),
        );

        const saveBtn = $('<button class="menu_button quicker-api__save-button" type="button"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></button>');
        const cancelBtn = $('<button class="menu_button" type="button"><span>取消</span></button>');
        const actions = $('<div class="st-router-editor-actions"></div>').append(saveBtn, cancelBtn);
        content.append(actions);
        const popup = new Popup(content, 'text', '', { large: false, wide: true, okButton: false, cancelButton: false });
        saveBtn.on('click', async () => {
            draft.name = String(nameInput.val() ?? '').trim().slice(0, 120) || 'Group';
            draft.enabled = enabledCheck.prop('checked');
            draft.currentLogicalModelId = String(logicalSelect.val() || '');
            Object.assign(group, normalizeGroup(draft));
            deps.save();
            renderGroupSelect();
            renderModelList();
            await popup.completeCancelled();
            toastr.success(`Group「${draft.name}」已保存。`);
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
        renderGroupEntries();
        renderModelList();
    });
    panel.find('#st_router_add_group').on('click', async () => {
        const name = await Popup.show.input('新增 Group', '');
        if (!name) return;
        const group = normalizeGroup({ name, currentLogicalModelId: deps.getLogicalModels()[0]?.id || '' });
        deps.getGroups().push(group);
        deps.setActiveGroupId(group.id);
        renderGroupSelect();
        renderGroupEntries();
        renderModelList();
        await openGroupEditor(group);
    });
    panel.find('#st_router_edit_group').on('click', () => {
        const group = activeGroup();
        if (group) void openGroupEditor(group);
    });
    panel.find('#st_router_add_provider').on('click', async () => {
        const name = await Popup.show.input('新增 Vendor', '');
        if (!name) return;
        const vendor = normalizeVendor({ name });
        deps.getVendors().push(vendor);
        deps.save();
        renderProviderList();
        await openVendorEditor(vendor);
    });
    panel.find('#st_router_add_entry').on('click', () => {
        const group = activeGroup();
        if (!group) {
            toastr.warning('请先新增 Group。');
            return;
        }
        if (deps.getVendors().length === 0) {
            toastr.warning('请先新增 Vendor。');
            return;
        }
        group.entries.push({ id: makeId('group-entry'), vendorId: deps.getVendors()[0].id, apiKey: '', label: 'Key', enabled: true });
        deps.save();
        renderGroupEntries();
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
