// Vendor 面板：Vendor 列表渲染 + 展开 Key 编辑 + 拉取模型 + 健康状态 + 编辑弹窗。
// 独立模块，降低 ui.ts 巨石；接收 VendorPanelContext 回调，无反向依赖。

import { getRequestHeaders } from '@sillytavern/script';
import { SECRET_KEYS, writeSecret } from '@sillytavern/scripts/secrets';
import { POPUP_TYPE, Popup } from '@sillytavern/scripts/popup';
import { escapeHtml } from '../../utils/text.js';
import { makeId } from '../../utils/id.js';
import { isKeyUnused, isVendorUnused } from '../ui-helpers.js';
import { FORMAT_LABELS, field, formatCooldownMs, statusBadge, successRateText, vendorStatus } from './ui-helpers2.js';
import {
    assignRealModel,
    disableVendorIfNoUsableKeys,
    isSpecialVariant,
    normalizeVendor,
    pruneOrphanLogicalModels,
    reconcileEntryMappings,
} from '../../domain/vendor.js';
import { ensureEmptySecret, readAuthoritativeSecretState, rotateSecretVerified } from '../../secrets/api.js';
import { isModelInCooldown, modelCooldownRemainingMs, recordModelSuccess } from '../../domain/model-health.js';
import type { Group, GroupEntry, Vendor } from '../../types.js';
import type { RoutingUIDeps } from '../ui.js';

export interface VendorPanelContext {
    deps: RoutingUIDeps;
    /** The jQuery element for #st_router_provider_list. */
    mount: JQuery<HTMLElement>;
    /** Returns the currently active group. */
    getActiveGroup(): Group | null;
    /** Re-render the logical model list (renderModelList in ui.ts). */
    reloadModelList(): void;
    /** Re-render the group summary (renderGroupSummary in ui.ts). */
    reloadGroupSummary(): void;
}

/** Which vendor rows are expanded (keyed by vendor id). */
const expandedVendors = new Set<string>();

/** 拉取间隔抖动：200~400ms 随机，避免多个 Vendor 连发触发限流。 */
function jitterDelay(): Promise<void> {
    const wait = 200 + Math.floor(Math.random() * 200);
    return new Promise(resolve => setTimeout(resolve, wait));
}

function enabledEntriesForVendor(vendor: Vendor, ctx: VendorPanelContext): GroupEntry[] {
    const entries: GroupEntry[] = [];
    for (const group of ctx.deps.getGroups()) {
        for (const entry of group.entries) {
            if (entry.vendorId === vendor.id && entry.apiKey && entry.enabled) entries.push(entry);
        }
    }
    return entries;
}

async function fetchModelsForVendor(vendor: Vendor, entry: GroupEntry, ctx: VendorPanelContext): Promise<string[] | null> {
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
            const logical = assignRealModel(ctx.deps.getLogicalModels(), model);
            if (!entry.mappings.some(mapping => mapping.realModel === model)) {
                entry.mappings.push({ id: makeId('mapping'), realModel: model, logicalModelId: logical.id });
            }
        }
        // 以最新拉取结果为权威：清除该 Key 不再存在的真实模型映射，并回收孤儿逻辑模型
        reconcileEntryMappings(entry, models);
        pruneOrphanLogicalModels(ctx.deps.getLogicalModels(), ctx.deps.getGroups());
        ctx.deps.save();
        return models;
    } catch (error) {
        console.error('[QuickerApi] fetch vendor models failed:', error);
        const message = error instanceof Error ? error.message : String(error);
        // 拉取失败视为该 Key 失效：禁用该 Key（enabled=false），保留其他 Key 的模型数据
        entry.enabled = false;
        entry.fetchedModels = [];
        entry.mappings = [];
        const vendorDisabled = disableVendorIfNoUsableKeys(vendor, ctx.deps.getGroups());
        ctx.deps.save();
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

/** 渲染单个 Key 下每个真实模型的健康状态胶囊：正常 / 冷却中(剩余) / 不可恢复(6h)，冷却/不可恢复附带手动恢复按钮。 */
function renderModelHealthForEntry(entry: GroupEntry, ctx: VendorPanelContext): JQuery<HTMLElement> {
    const now = Date.now();
    const realModels = [...new Set(entry.mappings.map(mapping => mapping.realModel))];
    const wrap = $('<div class="st-router-model-health"></div>');
    if (realModels.length === 0) return wrap;

    wrap.append($('<span class="st-router-model-health-label">').text('模型健康'));
    for (const realModel of realModels) {
        const pill = $('<span class="st-router-model-health-pill"></span>');
        const remainingMs = modelCooldownRemainingMs(entry, realModel, now);
        const remaining = Math.ceil(remainingMs / 1000);
        const kind = entry.lastErrorKindByModel?.[realModel];
        const isCooling = isModelInCooldown(entry, realModel, now);
        const name = $('<span>').text(realModel);

        let statusText = '正常';
        let statusClass = 'healthy';
        if (kind === 'fatal' && isCooling) {
            statusText = `不可恢复（${formatCooldownMs(remaining)}）`;
            statusClass = 'fatal';
        } else if (isCooling) {
            statusText = `冷却中 ${formatCooldownMs(remaining)}`;
            statusClass = 'cooldown';
        }
        pill.addClass(`st-router-model-health-pill--${statusClass}`).append(name, $('<span>').text(`· ${statusText}`));

        // 冷却 / 不可恢复 → 手动恢复按钮
        if (isCooling) {
            const resetBtn = $('<span class="reset-btn" role="button" tabindex="0" title="手动恢复该模型（清除冷却）"><i class="fa-solid fa-rotate-left"></i></span>');
            resetBtn.on('click', event => {
                event.stopPropagation();
                recordModelSuccess(entry, realModel);
                ctx.deps.save();
                renderProviders(ctx);
                toastr.success(`已手动恢复「${realModel}」的冷却。`);
            });
            pill.append(resetBtn);
        }
        wrap.append(pill);
    }
    return wrap;
}

function openVendorEditor(vendor: Vendor, ctx: VendorPanelContext): void {
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
        ctx.deps.save();
        renderProviders(ctx);
        ctx.reloadModelList();
        await popup.completeCancelled();
        toastr.success(`Vendor「${draft.name}」已保存。`);
    });
    cancelBtn.on('click', () => void popup.completeCancelled());
    void popup.show();
}

function renderProviders(ctx: VendorPanelContext): void {
    const vendors = ctx.deps.getVendors();
    const group = ctx.getActiveGroup();
    const providerList = ctx.mount;
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
            ctx.deps.save();
            renderProviders(ctx);
            ctx.reloadModelList();
        });
        row.append(enabledCheck);

        const isExpanded = expandedVendors.has(vendor.id);
        const expandArrow = $('<i class="fa-solid fa-chevron-right st-router-provider-expand"></i>');
        if (isExpanded) expandArrow.addClass('st-router-provider-expand--open');
        expandArrow.on('click', () => {
            if (expandedVendors.has(vendor.id)) expandedVendors.delete(vendor.id);
            else expandedVendors.add(vendor.id);
            renderProviders(ctx);
        });
        row.append(expandArrow);

        const info = $('<div class="st-router-provider-info st-router-provider-info--editable"></div>');
        info.append($('<span class="st-router-provider-name">').text(vendor.name));
        const endpointInput = $('<input class="text_pole st-router-provider-endpoint" type="text" maxlength="2048" placeholder="站点地址，如 https://api.example.com/v1">')
            .val(vendor.endpoint || '')
            .on('input', function () {
                vendor.endpoint = String($(this).val() ?? '').trim();
                ctx.deps.save();
            });
        info.append(endpointInput);
        const vendorModels = new Set<string>();
        for (const g of ctx.deps.getGroups()) {
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
            .on('click', () => void openVendorEditor(vendor, ctx));
        const deleteBtn = $('<button class="menu_button quicker-api__delete-button" type="button" title="删除"><i class="fa-solid fa-trash"></i></button>')
            .on('click', async () => {
                const confirm = await Popup.show.confirm('删除 Vendor', `确定删除「${escapeHtml(vendor.name)}」及其全部模型映射？`);
                if (!confirm) return;
                const list = ctx.deps.getVendors();
                const index = list.findIndex(item => item.id === vendor.id);
                if (index >= 0) list.splice(index, 1);
                for (const g of ctx.deps.getGroups()) g.entries = g.entries.filter(entry => entry.vendorId !== vendor.id);
                ctx.deps.save();
                renderProviders(ctx);
                ctx.reloadModelList();
                ctx.reloadGroupSummary();
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
                            ctx.deps.save();
                            keyRow.toggleClass('st-router-key-row--unused', isKeyUnused(entry));
                            row.toggleClass('st-router-provider--unused', isVendorUnused(vendor, vendor.id, vendorKeys));
                        });

                    // 名称
                    const labelInput = $('<input class="text_pole" type="text" maxlength="120" placeholder="名称，如：主号 / 备用">')
                        .val(entry.label || '')
                        .on('input', function () {
                            entry.label = String($(this).val() ?? '').trim() || 'Key';
                            ctx.deps.save();
                        });

                    // Key 输入
                    const keyInput = $('<input class="text_pole" type="password" maxlength="2048" autocomplete="off" placeholder="Key">')
                        .val(entry.apiKey || '')
                        .on('input', function () {
                            entry.apiKey = String($(this).val() ?? '').trim();
                            entry.secretId = '';
                            ctx.deps.save();
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
                            const models = await fetchModelsForVendor(vendor, entry, ctx);
                            if (!models) return;
                            renderProviders(ctx);
                            ctx.reloadModelList();
                            toastr.success(`Vendor「${vendor.name}」获取 ${models.length} 个模型并已映射。`);
                        });

                    // 模型数
                    const modelCount = $('<span class="st-router-key-col" title="该 Key 已拉取的模型数">').text(`${entry.fetchedModels.length} 模型`);

                    // 删除
                    const removeBtn = $('<button class="menu_button quicker-api__delete-button" type="button" title="删除条目"><i class="fa-solid fa-trash"></i></button>')
                        .on('click', () => {
                            group.entries = group.entries.filter(item => item.id !== entry.id);
                            ctx.deps.save();
                            renderProviders(ctx);
                            ctx.reloadGroupSummary();
                        });

                    keyRow.append(enabled, labelInput, keyInput, fetchBtn, modelCount, removeBtn);
                    keySection.append(keyRow);
                    // 模型健康状态
                    keySection.append(renderModelHealthForEntry(entry, ctx));
                }
            }

            // 添加 Key 按钮
            const addBtn = $('<button class="menu_button st-router-add" type="button" style="margin-top:4px"><i class="fa-solid fa-plus"></i><span>为此 Vendor 添加 Key</span></button>')
                .on('click', () => {
                    group.entries.push({ id: makeId('group-entry'), vendorId: vendor.id, apiKey: '', label: 'Key', enabled: true, fetchedModels: [], mappings: [] });
                    ctx.deps.save();
                    renderProviders(ctx);
                    ctx.reloadGroupSummary();
                });
            keySection.append(addBtn);
            container.append(keySection);
        }

        providerList.append(container);
    }
}

/**
 * 批量拉取所有 Vendor 的可用 Key 的模型。
 * 返回 { ok, skipped, failed } 用于调用方构造汇报消息。
 */
export interface BatchFetchResult {
    ok: number;
    skipped: number;
    failed: string[];
}

async function batchFetchAllModels(ctx: VendorPanelContext): Promise<BatchFetchResult> {
    const vendors = ctx.deps.getVendors();
    let ok = 0;
    let skipped = 0;
    const failed: string[] = [];
    const workItems: { vendor: Vendor; entry: GroupEntry }[] = [];
    for (const vendor of vendors) {
        const entries = enabledEntriesForVendor(vendor, ctx);
        if (entries.length === 0) {
            skipped++;
            continue;
        }
        for (const entry of entries) workItems.push({ vendor, entry });
    }
    for (let index = 0; index < workItems.length; index++) {
        const { vendor, entry } = workItems[index];
        const models = await fetchModelsForVendor(vendor, entry, ctx);
        if (models) ok++;
        else failed.push(`${vendor.name} / ${entry.label || 'Key'}`);
        if (index < workItems.length - 1) await jitterDelay();
    }
    return { ok, skipped, failed };
}

export function initVendorPanel(ctx: VendorPanelContext): { renderProviders(): void; batchFetchAllModels(): Promise<BatchFetchResult> } {
    return {
        renderProviders: () => renderProviders(ctx),
        batchFetchAllModels: () => batchFetchAllModels(ctx),
    };
}