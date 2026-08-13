// Provider（多 Key）+ 聚合模型选择面板。
// deps：{ getProviders, getRouting, save }（lifecycle 注入，避免循环 import）。
// 模型获取复用宿主后端通道（/api/backends/chat-completions/status）：临时注册密钥 → 服务器端拉取。
// 面板与旧版 Profile 区共存：插到 #quicker_api 之前，旧版区默认折叠（保留功能，快捷方案仍引用 profiles）。

import { getRequestHeaders } from '@sillytavern/script';
import { oai_settings } from '@sillytavern/scripts/openai';
import { SECRET_KEYS, writeSecret } from '@sillytavern/scripts/secrets';
import { Popup } from '@sillytavern/scripts/popup';
import { aggregateModels, keyUnits, modelsGroupedByKey } from '../domain/model-catalog.js';
import { unavailabilityReason } from '../domain/routing.js';
import { normalizeKey, normalizeProvider } from '../domain/provider.js';
import { escapeHtml } from '../utils/text.js';
import type { Provider, ProviderFormat, ProviderKey, RoutingSettings } from '../types.js';

function statusBadge(reason: string | null): string {
    const label: Record<string, string> = { disabled: '禁用', rpm: '限流', circuit: '熔断' };
    return `<span class="st-router-badge st-router-badge--${reason ?? 'ok'}">${reason ? (label[reason] ?? reason) : '可用'}</span>`;
}

const FORMAT_LABELS: Record<string, string> = { 'custom': 'OpenAI 兼容', 'custom-responses': 'OpenAI Responses', 'deepseek': 'DeepSeek' };

export interface RoutingUIDeps {
    getProviders(): Provider[];
    getRouting(): RoutingSettings;
    save(): void;
}

export function initRoutingUI(deps: RoutingUIDeps): { panel: JQuery<HTMLElement>; render(): void } {
    const panel = $(`
        <section id="st_router_panel" class="quicker-api">
            <div class="quicker-api__title">
                <span><i class="fa-solid fa-route"></i> 供应商路由 / Provider Routing</span>
                <span class="st-router-title-actions">
                    <button id="st_router_toggle_legacy" class="menu_button" type="button" title="旧版 API Profile 设置（过渡兼容）"><i class="fa-solid fa-clock-rotate-left"></i><span>旧版设置</span></button>
                    <span title="生成时按策略选择可用 key；失败只计数熔断，不重发"><i class="fa-solid fa-circle-info"></i></span>
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
                <label>供应商（一个网站可添加多个 key，各自 RPM / 权重 / 模型）</label>
                <div id="st_router_provider_list" class="st-router-list"></div>
                <button id="st_router_add_provider" class="menu_button st-router-add" type="button"><i class="fa-solid fa-plus"></i><span>新增供应商</span></button>
            </div>
            <div class="quicker-api__field">
                <div class="st-router-controls">
                    <label>模型清单</label>
                    <div class="st-router-view-toggle">
                        <button id="st_router_view_agg" class="menu_button active" type="button">按模型聚合</button>
                        <button id="st_router_view_key" class="menu_button" type="button">按 key 分组</button>
                    </div>
                </div>
                <div id="st_router_model_list" class="st-router-model-list"></div>
            </div>
        </section>
    `);

    const providerList = panel.find('#st_router_provider_list');
    const modelList = panel.find('#st_router_model_list');
    let modelView: 'aggregate' | 'byKey' = 'aggregate';

    function renderRoutingControls(): void {
        const routing = deps.getRouting();
        panel.find('#st_router_enable').prop('checked', routing.enabled);
        panel.find('#st_router_sticky_seconds').val(Number(routing.stickySeconds) || 0);
    }

    function renderProviderList(): void {
        const providers = deps.getProviders();
        providerList.empty();
        if (providers.length === 0) {
            providerList.append($('<div class="quicker-api__status">').text('还没有供应商。新增后填写 endpoint、添加 key，拉取模型即可参与路由。'));
            return;
        }
        for (const provider of providers) {
            const row = $('<div class="st-router-provider"></div>');
            row.append(
                $('<label class="checkbox_label"><input type="checkbox" class="st-router-provider-enabled"></label>'),
            );
            row.find('input').prop('checked', provider.enabled).on('change', function () {
                provider.enabled = $(this).prop('checked');
                deps.save();
                renderProviderList();
                renderModelList();
            });
            const info = $('<div class="st-router-provider-info"></div>');
            info.append(
                $('<span class="st-router-provider-name">').text(provider.name),
                $('<span class="st-router-provider-endpoint">').text(provider.endpoint || '（无 endpoint）'),
                $('<span class="st-router-provider-meta">').text(`${FORMAT_LABELS[provider.format] ?? provider.format} · ${provider.keys.length} 个 key · 模型 ${aggregateModels([provider]).length}`),
            );
            row.append(info);
            const editBtn = $('<button class="menu_button" type="button" title="编辑"><i class="fa-solid fa-pen"></i></button>')
                .on('click', () => void openProviderEditor(provider));
            const deleteBtn = $('<button class="menu_button quicker-api__delete-button" type="button" title="删除"><i class="fa-solid fa-trash"></i></button>')
                .on('click', async () => {
                    const confirm = await Popup.show.confirm('删除供应商', `确定删除「${escapeHtml(provider.name)}」及其全部 key？`);
                    if (!confirm) return;
                    const list = deps.getProviders();
                    const index = list.findIndex(item => item.id === provider.id);
                    if (index >= 0) list.splice(index, 1);
                    deps.save();
                    renderProviderList();
                    renderModelList();
                });
            const actions = $('<div class="st-router-provider-actions"></div>');
            actions.append(editBtn, deleteBtn);
            row.append(actions);
            providerList.append(row);
        }
    }

    function renderModelList(): void {
        const providers = deps.getProviders();
        modelList.empty();
        if (modelView === 'byKey') {
            const groups = modelsGroupedByKey(providers);
            if (groups.length === 0) {
                modelList.append($('<div class="quicker-api__status">').text('先给 key 拉取模型清单。'));
                return;
            }
            for (const { provider, key, models } of groups) {
                const unit = { provider, key };
                const header = $('<div class="st-router-key-group-header"></div>')
                    .append($('<span class="st-router-key-group-title">').text(`${provider.name} / ${key.label}`))
                    .append($('<span class="st-router-key-group-meta">').text(`rpm ${key.rpm === 0 ? '∞' : key.rpm} · 权重 ${key.weight}`))
                    .append(statusBadge(keyStatus(unit)));
                const chips = $('<div class="st-router-model-list"></div>');
                for (const model of models) chips.append(makeModelChip(model));
                modelList.append($('<div class="st-router-key-group"></div>').append(header, chips));
            }
            return;
        }
        const models = aggregateModels(providers);
        if (models.length === 0) {
            modelList.append($('<div class="quicker-api__status">').text('先给 key 拉取模型清单。'));
            return;
        }
        for (const model of models) modelList.append(makeModelChip(model));
    }

    /** key 级状态（无模型上下文）：仅启用/禁用。 */
    function keyStatus(unit: { provider: Provider; key: ProviderKey }): string | null {
        if (unit.provider.enabled === false || unit.key.enabled === false) return 'disabled';
        return null;
    }

    /** 模型的任意承载单元是否处于熔断（UI 高亮用）。 */
    function modelHasCircuitBrokenUnit(model: string, now: number): boolean {
        const units = keyUnits(deps.getProviders()).filter(({ key }) => (key?.fetchedModels || []).includes(model));
        return units.some(unit => unavailabilityReason(unit, model, now) === 'circuit');
    }

    function makeModelChip(model: string): JQuery<HTMLElement> {
        const providers = deps.getProviders();
        const carrying = keyUnits(providers).filter(({ key }) => (key?.fetchedModels || []).includes(model));
        const badges = carrying.map(({ provider, key }) => {
            const reason = unavailabilityReason({ provider, key }, model, Date.now());
            return `<span class="st-router-badge st-router-badge--${reason ?? 'ok'}">${escapeHtml(provider.name)}/${escapeHtml(key.label)}</span>`;
        }).join(' ');
        const chip = $('<button class="st-router-model-chip" type="button"></button>')
            .append($('<span class="st-router-model-name">').text(model))
            .append($('<span class="st-router-model-providers">').html(badges));
        // 熔断供应商承载的模型：高亮提示
        if (modelHasCircuitBrokenUnit(model, Date.now())) {
            chip.addClass('st-router-model-chip--degraded');
            chip.attr('title', '该模型的部分供应商已熔断，将自动改用其他可用供应商。');
        }
        chip.on('click', () => selectModel(model));
        return chip;
    }

    function selectModel(model: string): void {
        oai_settings.custom_model = model;
        $('#custom_model_id').val(model).trigger('input');
        toastr.success(`已选择模型「${model}」：生成时将按策略选择可用 key。`);
    }

    /** 获取模型清单（照宿主连接按钮）：writeSecret 保存密钥 → status 后端拉取 → 存 list。返回模型数，失败返回 null。 */
    async function fetchModelsForKey(provider: Provider, key: ProviderKey): Promise<number | null> {
        const isDeepseek = provider.format === 'deepseek';
        const secretKey = isDeepseek ? SECRET_KEYS.DEEPSEEK : SECRET_KEYS.CUSTOM;
        try {
            let secretId: string | null = null;
            if (key.apiKey) {
                secretId = await writeSecret(secretKey, key.apiKey, `st-api-router:${provider.name}/${key.label}`);
            }
            const statusBody: Record<string, any> = {
                chat_completion_source: isDeepseek ? 'deepseek' : 'custom',
                custom_api_format: provider.format === 'custom-responses' ? 'openai_responses' : 'openai_compat',
                ...(secretId ? { secret_id: secretId } : {}),
            };
            if (isDeepseek) {
                statusBody.reverse_proxy = provider.endpoint;
            } else {
                statusBody.custom_url = provider.endpoint;
            }
            const statusRes = await fetch('/api/backends/chat-completions/status', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify(statusBody),
            });
            if (!statusRes.ok) throw new Error(`status HTTP ${statusRes.status}`);
            const statusData: any = await statusRes.json();
            if (statusData?.error) {
                throw new Error(statusData?.message || 'status 检查失败');
            }
            const raw = statusData?.data;
            const list: any[] = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
            const models: string[] = [...new Set(list.map((item: any) => String(item?.id || item?.model || '').trim()).filter(Boolean))].slice(0, 1000);
            key.fetchedModels = models;
            if (models.length === 0) {
                toastr.warning(`「${provider.name} / ${key.label}」未获取到模型（响应 data 为空）。`);
            } else {
                toastr.success(`「${provider.name} / ${key.label}」获取到 ${models.length} 个模型。`);
            }
            return models.length;
        } catch (error) {
            console.error('[st-api-router] fetch models failed:', error);
            const message = error instanceof Error ? error.message : String(error);
            toastr.error(`「${provider.name} / ${key.label}」获取模型失败：${message}。`);
            return null;
        }
    }

    function openKeyEditor(provider: Provider, key: ProviderKey): void {
        const draft = normalizeKey(structuredClone(key));
        const content = $('<div class="st-router-editor"></div>');
        const field = (labelText: string, control: JQuery<HTMLElement>) => $('<div class="quicker-api__field"></div>')
            .append($('<label>').text(labelText), control);
        const labelInput = $('<input class="text_pole" type="text" maxlength="120">').val(draft.label);
        const keyInput = $('<input class="text_pole" type="password" maxlength="2048" autocomplete="off" placeholder="无凭据">').val(draft.apiKey);
        const rpmInput = $('<input class="text_pole" type="number" min="0" step="1">').val(draft.rpm);
        const weightInput = $('<input class="text_pole" type="number" min="0" step="1">').val(draft.weight);
        const enabledCheck = $('<input type="checkbox">').prop('checked', draft.enabled);
        content.append(
            field('Key 名称', labelInput),
            field('API Key', keyInput),
            field('RPM 上限（0 = 不限）', rpmInput),
            field('权重', weightInput),
            $('<label class="checkbox_label st-router-editor-enabled"></label>').append(enabledCheck, ' 启用'),
        );
        const saveBtn = $('<button class="menu_button quicker-api__save-button" type="button"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></button>');
        const cancelBtn = $('<button class="menu_button" type="button"><span>取消</span></button>');
        const actions = $('<div class="st-router-editor-actions"></div>').append(saveBtn, cancelBtn);
        content.append(actions);
        const popup = new Popup(content, 'text', '', { large: false, wide: true, okButton: false, cancelButton: false });
        saveBtn.on('click', async () => {
            draft.label = String(labelInput.val() ?? '').trim().slice(0, 120) || 'Key';
            draft.apiKey = String(keyInput.val() ?? '').trim();
            draft.rpm = Math.max(0, Math.floor(Number(rpmInput.val()) || 0));
            draft.weight = Math.max(0, Number(weightInput.val()) || 1);
            draft.enabled = enabledCheck.prop('checked');
            Object.assign(key, normalizeKey(draft));
            deps.save();
            renderProviderList();
            renderModelList();
            await popup.completeCancelled();
            toastr.success(`Key「${draft.label}」已保存。`);
        });
        cancelBtn.on('click', () => void popup.completeCancelled());
        void popup.show();
    }

    function openProviderEditor(provider: Provider): void {
        const draft = normalizeProvider(structuredClone(provider));
        const content = $('<div class="st-router-editor"></div>');
        const field = (labelText: string, control: JQuery<HTMLElement>) => $('<div class="quicker-api__field"></div>')
            .append($('<label>').text(labelText), control);
        const nameInput = $('<input class="text_pole" type="text" maxlength="120">').val(draft.name);
        const formatSelect = $('<select class="text_pole"></select>');
        for (const [value, label] of Object.entries(FORMAT_LABELS)) {
            formatSelect.append($('<option>').val(value).text(label));
        }
        formatSelect.val(draft.format);
        const endpointInput = $('<input class="text_pole" type="text" maxlength="2048" placeholder="custom 系列填 Base URL；deepseek 填反代地址（可留空用官方）">').val(draft.endpoint);
        const enabledCheck = $('<input type="checkbox">').prop('checked', draft.enabled);
        content.append(
            field('名称', nameInput),
            field('格式', formatSelect),
            field('Endpoint', endpointInput),
            $('<label class="checkbox_label st-router-editor-enabled"></label>').append(enabledCheck, ' 启用'),
        );
        // ── Key 列表 ──
        const keySection = $('<div class="quicker-api__field"></div>')
            .append($('<label>').text('Key 列表'));
        const keyListEl = $('<div class="st-router-list"></div>');
        const renderKeys = () => {
            keyListEl.empty();
            for (const key of draft.keys) {
                const row = $('<div class="st-router-key-row"></div>');
                row.append(
                    $('<span class="st-router-key-label">').text(key.label || 'Key'),
                    $('<span class="st-router-key-meta">').text(`rpm ${key.rpm === 0 ? '∞' : key.rpm} · 权重 ${key.weight} · 模型 ${key.fetchedModels.length} · ${key.enabled ? '启用' : '禁用'}`),
                );
                const fetchBtn = $('<button class="menu_button" type="button" title="拉取模型清单（只记录）"><i class="fa-solid fa-arrows-rotate"></i></button>')
                    .on('click', async () => {
                        const count = await fetchModelsForKey(draft, key);
                        if (count === null) return;
                        // 拉取结果即时落回真实配置（不依赖编辑器「保存」，关闭弹窗也不丢失）
                        Object.assign(provider, normalizeProvider(draft));
                        deps.save();
                        renderKeys();
                        renderProviderList();
                        renderModelList();
                    });
                const editBtn = $('<button class="menu_button" type="button" title="编辑"><i class="fa-solid fa-pen"></i></button>')
                    .on('click', () => { void openKeyEditor(draft, key); renderKeys(); });
                const deleteBtn = $('<button class="menu_button quicker-api__delete-button" type="button" title="删除"><i class="fa-solid fa-trash"></i></button>')
                    .on('click', () => {
                        draft.keys = draft.keys.filter(item => item.id !== key.id);
                        renderKeys();
                    });
                const actions = $('<div class="st-router-provider-actions"></div>').append(fetchBtn, editBtn, deleteBtn);
                row.append(actions);
                keyListEl.append(row);
            }
        };
        renderKeys();
        const addKeyBtn = $('<button class="menu_button st-router-add" type="button"><i class="fa-solid fa-plus"></i><span>添加 Key</span></button>')
            .on('click', () => {
                const key = normalizeKey({ label: `Key ${draft.keys.length + 1}` });
                draft.keys.push(key);
                renderKeys();
                void openKeyEditor(draft, key);
            });
        keySection.append(keyListEl, addKeyBtn);
        content.append(keySection);
        const saveBtn = $('<button class="menu_button quicker-api__save-button" type="button"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></button>');
        const cancelBtn = $('<button class="menu_button" type="button"><span>取消</span></button>');
        const actions = $('<div class="st-router-editor-actions"></div>').append(saveBtn, cancelBtn);
        content.append(actions);
        const popup = new Popup(content, 'text', '', { large: false, wide: true, okButton: false, cancelButton: false });
        saveBtn.on('click', async () => {
            draft.name = String(nameInput.val() ?? '').trim().slice(0, 120) || 'Provider';
            draft.format = String(formatSelect.val() ?? 'custom').trim() as ProviderFormat;
            draft.endpoint = String(endpointInput.val() ?? '').trim();
            draft.enabled = enabledCheck.prop('checked');
            Object.assign(provider, normalizeProvider(draft));
            deps.save();
            renderProviderList();
            renderModelList();
            await popup.completeCancelled();
            toastr.success(`供应商「${draft.name}」已保存。`);
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
    panel.find('#st_router_add_provider').on('click', async () => {
        const name = await Popup.show.input('新增供应商', '');
        if (!name) return;
        const provider = normalizeProvider({ name });
        deps.getProviders().push(provider);
        deps.save();
        renderProviderList();
        renderModelList();
        await openProviderEditor(provider);
    });
    panel.find('#st_router_view_agg').on('click', function () {
        modelView = 'aggregate';
        panel.find('#st_router_view_agg').addClass('active');
        panel.find('#st_router_view_key').removeClass('active');
        renderModelList();
    });
    panel.find('#st_router_view_key').on('click', function () {
        modelView = 'byKey';
        panel.find('#st_router_view_key').addClass('active');
        panel.find('#st_router_view_agg').removeClass('active');
        renderModelList();
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
    renderProviderList();
    renderModelList();

    return { panel, render: () => { renderRoutingControls(); renderProviderList(); renderModelList(); } };
}
