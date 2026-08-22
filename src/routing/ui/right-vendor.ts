// 右栏：Vendor 管理标签页。
// 纯渲染函数，由 console-panel.ts 调用。

import { getRequestHeaders } from '@sillytavern/script';
import { SECRET_KEYS, writeSecret } from '@sillytavern/scripts/secrets';
import { POPUP_TYPE, Popup } from '@sillytavern/scripts/popup';
import { showEditorDialog } from './controls.js';
import { groups, logicalModels, mappingRules, vendors } from '../../settings/access.js';
import { isModelInCooldown, recordModelSuccess } from '../../domain/model-health.js';
import {
    applyMappingRules,
    assignRealModel,
    isSpecialVariant,
    normalizeGroupEntry,
    normalizeVendor,
    pruneOrphanLogicalModels,
    reconcileEntryMappings,
} from '../../domain/vendor.js';
import { formatCooldownMs, successRateText, vendorStatus } from './ui-helpers2.js';
import { makeId } from '../../utils/id.js';
import { clearQuickApiSecrets, ensureEmptySecret, readAuthoritativeSecretState, rotateSecretVerified } from '../../secrets/api.js';
import { isKeyUnused, isVendorUnused } from '../ui-helpers.js';
import { activeGroup, cslField, saveSettingsNow } from './console-helpers.js';
import type { GroupEntry, Vendor } from '../../types.js';

const expandedVendors = new Set<string>();

/** 渲染 Vendor 管理列表到 rightEl 容器。 */
export function renderRightVendor(
    rightEl: JQuery<HTMLElement> | null,
    onRefreshDashboard: () => void,
): void {
    if (!rightEl) return;
    rightEl.empty();

    // ── 批量刷新全部 Vendor 模型 ──
    const batchBar = $('<div class="csl-vendor-batch" style="display:flex;gap:4px;margin-bottom:6px"></div>');
    const batchBtn = $('<button class="csl-btn csl-btn--primary" type="button" title="用各 Vendor 已配置的 Key 重新拉取模型并刷新列表"><i class="fa-solid fa-arrows-rotate"></i><span>刷新全部模型</span></button>')
        .on('click', async () => {
            const vendorList = vendors();
            if (vendorList.length === 0) {
                toastr.info('还没有 Vendor。先新增 Vendor 并配置 Key。');
                return;
            }
            const btn = batchBtn;
            btn.prop('disabled', true);
            try {
                let ok = 0, skipped = 0;
                const failed: string[] = [];
                for (let index = 0; index < vendorList.length; index++) {
                    const v = vendorList[index];
                    batchBtn.find('span').text(`刷新中 ${index + 1}/${vendorList.length}…`);
                    const localGroup = activeGroup();
                    const entry = localGroup?.entries.find(e => e.vendorId === v.id && e.apiKey && e.enabled);
                    if (!entry) { skipped++; continue; }
                    const result = await fetchModelsForVendor(v, entry, { quiet: true });
                    if (result) ok++;
                    const { promise: pause, resolve: resume } = Promise.withResolvers<void>();
                    setTimeout(resume, 100);
                    await pause;
                }
                saveSettingsNow();
                renderRightVendor(rightEl, onRefreshDashboard);
                onRefreshDashboard();
                const parts = [`成功 ${ok} 个`];
                if (skipped > 0) parts.push(`无可用 Key 跳过 ${skipped} 个 Vendor`);
                if (failed.length > 0) parts.push(`失败 ${failed.length} 个（${failed.join('、')}）`);
                toastr.success(`模型刷新完成：${parts.join('，')}。`);
            } finally {
                btn.prop('disabled', false);
            }
        });
    batchBar.append(batchBtn);
    rightEl.append(batchBar);

    const vendorList = vendors();
    if (vendorList.length === 0) {
        rightEl.append($('<div class="csl-empty">').text('还没有 Vendor。点击下方"新增 Vendor"添加。'));
        rightEl.append(renderAddVendorBtn(onRefreshDashboard));
        return;
    }
    const group = activeGroup();
    // 启用的 Vendor 排在前面，禁用的排在后面（各自按名称序）
    const sortedVendors = [...vendorList].sort((a, b) => {
        if (!!a.enabled !== !!b.enabled) return a.enabled ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    for (const vendor of sortedVendors) {
        const container = $('<div class="csl-vendor-row"></div>');
        const groupEntries = group?.entries.filter(e => e.vendorId === vendor.id) ?? [];
        const unused = isVendorUnused(vendor, vendor.id, groupEntries);
        if (unused) container.addClass('csl-vendor-row--unused');

        // 头行：启用 + 展开 + 名称 + 状态 + 操作
        const headRow = $('<div class="csl-vendor-head"></div>');

        const enabledCheck = $('<input type="checkbox">').prop('checked', vendor.enabled)
            .on('change', function () {
                vendor.enabled = $(this).prop('checked');
                if (vendor.enabled) vendor.disabledReason = '';
                saveSettingsNow();
                renderRightVendor(rightEl, onRefreshDashboard);
                onRefreshDashboard();
            });
        headRow.append(enabledCheck);

        const isExpanded = expandedVendors.has(vendor.id);
        const expandArrow = $('<i class="fa-solid fa-chevron-right csl-vendor-expand"></i>')
            .toggleClass('csl-vendor-expand--open', isExpanded)
            .on('click', () => {
                if (expandedVendors.has(vendor.id)) expandedVendors.delete(vendor.id);
                else expandedVendors.add(vendor.id);
                renderRightVendor(rightEl, onRefreshDashboard);
            });
        headRow.append(expandArrow);

        const statusBadge = vendorStatus(vendor);
        const statusText = statusBadge === 'disabled' ? '禁用' : statusBadge === 'rpm' ? '限流' : '可用';
        const statusClass = statusBadge === 'disabled' ? 'csl-vendor-badge--disabled' : statusBadge === 'rpm' ? 'csl-vendor-badge--rpm' : 'csl-vendor-badge--ok';
        const nameSpan = $('<span class="csl-vendor-name"></span>').text(vendor.name);
        const badge = $(`<span class="csl-vendor-badge ${statusClass}"></span>`).text(statusText);
        // 元信息（格式 + 成功率）放到副行，避免挤压名称横排
        const total = (Number(vendor.successes) || 0) + (Number(vendor.failures) || 0);
        const rate = total > 0 ? Math.round((Number(vendor.successes) || 0) / total * 100) : 0;
        const meta = $('<span class="csl-vendor-meta"></span>');
        meta.append(document.createTextNode(`${vendor.format === 'deepseek' ? 'DeepSeek' : 'OpenAI 兼容'} `));
        if (total > 0) {
            const bar = $('<span class="csl-vendor-rate-bar"></span>');
            const fill = $('<span class="csl-vendor-rate-fill"></span>').css('width', `${rate}%`);
            if (rate >= 80) fill.css('background', '#7ecf8a');
            else if (rate >= 50) fill.css('background', '#e0c07e');
            else fill.css('background', '#e08a8a');
            bar.append(fill);
            meta.append(bar, document.createTextNode(` ${rate}%`));
        } else {
            meta.append(document.createTextNode('无历史'));
        }
        headRow.append(nameSpan, badge);
        const subRow = $('<div class="csl-vendor-subrow"></div>').append(meta);

        // 操作按钮
        const actions = $('<span class="csl-vendor-actions"></span>');
        const editBtn = $('<button class="csl-btn csl-btn--icon" type="button" title="编辑 Vendor"><i class="fa-solid fa-pen"></i></button>')
            .on('click', () => { openVendorEditor(vendor, () => { renderRightVendor(rightEl, onRefreshDashboard); onRefreshDashboard(); }); });
        actions.append(editBtn);
        if (vendor.enabled) {
            const fetchBtn = $('<button class="csl-btn csl-btn--icon" type="button" title="拉取模型"><i class="fa-solid fa-arrows-rotate"></i></button>')
                .on('click', async () => {
                    const btn = fetchBtn;
                    btn.prop('disabled', true);
                    try {
                        const entry = groupEntries.find(e => e.apiKey && e.enabled);
                        if (!entry) { toastr.warning('该 Vendor 在当前分组没有可用 Key。'); return; }
                        await fetchModelsForVendor(vendor, entry);
                        saveSettingsNow();
                        renderRightVendor(rightEl, onRefreshDashboard);
                        onRefreshDashboard();
                        toastr.success(`Vendor「${vendor.name}」模型已刷新。`);
                    } finally {
                        btn.prop('disabled', false);
                    }
                });
            actions.append(fetchBtn);
        }

        headRow.append(actions);
        container.append(headRow, subRow);

        // 展开区：Key 列表 + 模型健康（启用在前、禁用在后）
        if (isExpanded) {
            const keyList = $('<div class="csl-vendor-keys"></div>');
            const sortedEntries = [...groupEntries].sort((a, b) => {
                if (!!a.enabled !== !!b.enabled) return a.enabled ? -1 : 1;
                return String(a.label ?? '').localeCompare(String(b.label ?? ''), undefined, { sensitivity: 'base' });
            });
            for (const entry of sortedEntries) {
                const keyRow = $('<div class="csl-vendor-key-row"></div>');
                const keyUnused = isKeyUnused(entry);
                if (keyUnused) keyRow.addClass('csl-vendor-key-row--unused');

                const keyEnabled = $('<input type="checkbox">').prop('checked', entry.enabled)
                    .on('change', function () {
                        entry.enabled = $(this).prop('checked');
                        saveSettingsNow();
                        renderRightVendor(rightEl, onRefreshDashboard);
                    });
                keyRow.append(keyEnabled);

                const labelInput = $('<input class="text_pole csl-vendor-key-label" type="text" maxlength="120" placeholder="Key 名称">').val(entry.label || 'Key')
                    .attr('aria-label', 'Key 名称')
                    .on('input', function () {
                        entry.label = String($(this).val() ?? '').trim().slice(0, 120) || 'Key';
                        saveSettingsNow();
                    });
                keyRow.append(labelInput);
                const keyWeight = $('<input class="text_pole csl-vendor-key-weight" type="number" min="0.01" step="0.1" title="Key 权重：同一 Vendor 内的相对概率" aria-label="Key 权重">')
                    .val(entry.weight ?? 1)
                    .on('change', function () {
                        const value = Number($(this).val());
                        entry.weight = Number.isFinite(value) && value > 0 ? value : 1;
                        $(this).val(entry.weight);
                        saveSettingsNow();
                    });
                keyRow.append(keyWeight);

                const keyInput = $('<input class="text_pole" type="password" maxlength="2048" autocomplete="off" placeholder="Key">').val(entry.apiKey)
                    .on('input', function () {
                        entry.apiKey = String($(this).val() ?? '').trim();
                        entry.secretId = '';
                        saveSettingsNow();
                    });
                keyRow.append(keyInput);

                const fetchBtn = $('<button class="csl-btn csl-btn--icon" type="button" title="使用此 Key 拉取模型"><i class="fa-solid fa-arrows-rotate"></i></button>')
                    .on('click', async () => {
                        if (!entry.apiKey) {
                            toastr.warning('请先填入该 Key。');
                            return;
                        }
                        fetchBtn.prop('disabled', true);
                        try {
                            const models = await fetchModelsForVendor(vendor, entry);
                            if (models) {
                                renderRightVendor(rightEl, onRefreshDashboard);
                                onRefreshDashboard();
                                toastr.success(`Key「${entry.label || 'Key'}」模型已刷新（${models.length} 个）。`);
                            }
                        } finally {
                            fetchBtn.prop('disabled', false);
                        }
                    });
                keyRow.append(fetchBtn);
                // 删除 Key
                const delBtn = $('<button class="csl-btn csl-btn--icon csl-btn--danger" type="button" title="删除该 Key"><i class="fa-solid fa-trash"></i></button>')
                    .on('click', async () => {
                        const confirmed = await Popup.show.confirm('删除 Key', `删除 Key「${entry.label || 'Key'}」（Vendor「${vendor.name}」）？`);
                        if (!confirmed || !group) return;
                        group.entries = group.entries.filter(item => item.id !== entry.id);
                        saveSettingsNow();
                        renderRightVendor(rightEl, onRefreshDashboard);
                        onRefreshDashboard();
                        toastr.success('Key 已删除。');
                    });
                keyRow.append(delBtn);

                // 模型健康胶囊：异常(冷却/不可恢复)直接显示；正常聚合进「N 个正常」折叠
                const now = Date.now();
                const realModels = [...new Set(entry.mappings.map(mapping => mapping.realModel))];
                if (realModels.length > 0) {
                    const healthPills = $('<div class="csl-vendor-health"></div>');
                    const abnormalPills: JQuery<HTMLElement>[] = [];
                    const normalPills: JQuery<HTMLElement>[] = [];
                    for (const realModel of realModels) {
                        const isCooling = isModelInCooldown(entry, realModel, now);
                        const remainingMs = entry.circuitsByModel?.[realModel] ? entry.circuitsByModel[realModel] - now : 0;
                        const kind = entry.lastErrorKindByModel?.[realModel];
                        let cls = 'csl-health--healthy csl-health--muted';
                        let label = '';
                        if (kind === 'fatal' && isCooling) {
                            cls = 'csl-health--fatal';
                            label = `不可恢复 ${formatCooldownMs(remainingMs)}`;
                        } else if (isCooling) {
                            cls = 'csl-health--cooldown';
                            label = `冷却 ${formatCooldownMs(remainingMs)}`;
                        }
                        const pill = $(`<span class="csl-health-pill ${cls}"></span>`);
                        if (label) pill.append($('<span>⚠️</span>'));
                        pill.append($('<span class="csl-health-pill-model">').text(realModel));
                        if (label) pill.append($('<span class="csl-health-pill-state">').text(label));
                        pill.prop('title', `${realModel}${label ? `：${label}` : '（正常）'}`);
                        if (isCooling) {
                            const resetBtn = $('<span class="csl-health-reset" title="手动恢复"><i class="fa-solid fa-rotate-left"></i></span>')
                                .on('click', async () => {
                                    const confirmed = await Popup.show.confirm('手动恢复', `确定手动恢复「${realModel}」的冷却？`);
                                    if (!confirmed) return;
                                    recordModelSuccess(entry, realModel);
                                    saveSettingsNow();
                                    renderRightVendor(rightEl, onRefreshDashboard);
                                    onRefreshDashboard();
                                    toastr.success(`已手动恢复「${realModel}」的冷却。`);
                                });
                            pill.append(resetBtn);
                        }
                        (label ? abnormalPills : normalPills).push(pill);
                    }
                    // 异常直接显示
                    healthPills.append(...abnormalPills);
                    // 正常聚合折叠
                    if (normalPills.length > 0) {
                        const normalWrap = $('<span class="csl-health-normal"></span>');
                        const toggle = $('<span class="csl-health-normal-toggle" role="button" tabindex="0">').text(`🔽 ${normalPills.length} 个正常`);
                        let normalOpen = false;
                        const renderToggle = () => toggle.text(normalOpen ? `🔼 ${normalPills.length} 个正常` : `🔽 ${normalPills.length} 个正常`);
                        toggle.on('click', () => { normalOpen = !normalOpen; renderToggle(); normalPool.toggle(normalOpen); });
                        toggle.on('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle.trigger('click'); } });
                        const normalPool = $('<span class="csl-health-normal-pool" style="display:none"></span>').append(...normalPills);
                        normalWrap.append(toggle, normalPool);
                        healthPills.append(normalWrap);
                    }
                    keyRow.append(healthPills);
                }
                keyList.append(keyRow);
            }
            // 添加 Key 入口（追加 GroupEntry 到当前分组该 Vendor 下）
            const addKeyWrap = $('<div class="csl-vendor-add-wrap" style="padding:4px 0 0"></div>');
            const addKeyBtn = $('<button class="csl-btn csl-btn--secondary" type="button"><i class="fa-solid fa-plus"></i><span>添加 Key</span></button>')
                .on('click', () => {
                    if (!group) { toastr.warning('当前没有分组。'); return; }
                    const entry = normalizeGroupEntry({
                        vendorId: vendor.id,
                        apiKey: '',
                        label: `Key ${group.entries.filter(e => e.vendorId === vendor.id).length + 1}`,
                        enabled: true,
                    });
                    group.entries.push(entry);
                    saveSettingsNow();
                    renderRightVendor(rightEl, onRefreshDashboard);
                    toastr.success('已添加 Key，请填入密钥。');
                });
            addKeyWrap.append(addKeyBtn);
            keyList.append(addKeyWrap);
            container.append(keyList);
        }

        rightEl.append(container);
    }
    rightEl.append(renderAddVendorBtn(onRefreshDashboard));
}

function renderAddVendorBtn(onRefreshDashboard: () => void): JQuery<HTMLElement> {
    const wrap = $('<div class="csl-vendor-add-wrap"></div>');
    const addBtn = $('<button class="csl-btn csl-btn--secondary" type="button"><i class="fa-solid fa-plus"></i><span>新增 Vendor</span></button>')
        .on('click', () => {
            const content = $('<div></div>');
            const nameInput = $('<input class="text_pole" type="text" maxlength="120" placeholder="如：硅基流动 / OpenRouter">');
            const endpointInput = $('<input class="text_pole" type="text" maxlength="2048" placeholder="站点 API 地址，如 https://api.example.com/v1">');
            content.append(
                $('<div class="csl-empty">').text('名称用于在列表中识别该 Vendor；Endpoint 填站点 API 地址。'),
                cslField('名称（识别用）', nameInput),
                cslField('Endpoint（站点 API 地址）', endpointInput),
            );
            showEditorDialog({
                title: '新增 Vendor',
                content,
                onSave: () => {
                    const name = String(nameInput.val() ?? '').trim().slice(0, 120);
                    if (!name) { toastr.warning('请填写 Vendor 名称。'); return false; }
                    const endpoint = String(endpointInput.val() ?? '').trim().slice(0, 2048);
                    const vendor = normalizeVendor({ name, endpoint });
                    vendors().push(vendor);
                    saveSettingsNow();
                    onRefreshDashboard();
                },
                successMessage: `Vendor「${nameInput.val()}」已添加。`,
            });
        });
    wrap.append(addBtn);
    return wrap;
}

function openVendorEditor(vendor: Vendor, onDone: () => void): void {
    const draft = normalizeVendor(structuredClone(vendor));
    const content = $('<div class="csl-editor"></div>');
    const nameInput = $('<input class="text_pole" type="text" maxlength="120" placeholder="识别用名称，如：硅基流动">').val(draft.name);
    const formatSelect = $('<select class="text_pole"></select>');
    for (const [value, label] of Object.entries({ 'custom': 'OpenAI 兼容', 'deepseek': 'DeepSeek' })) {
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
        cslField('名称', nameInput, '列表里用于识别，不会发给站点'),
        cslField('格式', formatSelect, '决定请求协议：Custom 走 OpenAI 兼容接口；DeepSeek 走 ST 原生 DeepSeek 源'),
        cslField('Endpoint', endpointInput, '站点 API 地址。custom 系列填 Base URL（如 https://api.xxx.com/v1）；deepseek 填反代地址'),
        cslField('RPM 上限（0 = 不限）', rpmInput, '该 Vendor 每分钟最多请求次数，所有分组共享此限制'),
        cslField('上下文上限（0 = 不限制）', contextInput, '路由到该 Vendor 时，SillyTavern 的总上下文预算会被钳制到不超过这个值'),
        cslField('输入 token 上限（0 = 不限制）', inputTokensInput, '输入 token 预算 = 总上下文 - 输出上限。填了此项会按 输入 + 输出 推导并钳制总上下文'),
        cslField('输出 token 上限（0 = 不限制）', outputTokensInput, '路由到该 Vendor 时，SillyTavern 的输出 token 上限会被钳制到不超过这个值'),
        cslField('权重', weightInput, '选路权重：数值越大越容易被随机选中（实际概率还会叠加历史成功率加成）'),
        $('<label class="checkbox_label"></label>').append(enabledCheck, ' 启用（参与路由）'),
    );

    showEditorDialog({
        title: `编辑 Vendor「${vendor.name}」`,
        content,
        onSave: () => {
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
            saveSettingsNow();
            onDone();
        },
        successMessage: `Vendor「${draft.name}」已保存。`,
    });
}

export async function fetchModelsForVendor(vendor: Vendor, entry: GroupEntry, opts: { quiet?: boolean } = {}): Promise<string[] | null> {
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
        if (!secretId) {
            // 不带 secret_id 的 status 请求会让服务端回退到「当前活动密钥」，可能把原生 Key 泄给该端点
            if (!opts.quiet) toastr.error(`Key「${entry.label || 'Key'}」（Vendor「${vendor.name}」）无法写入或定位 secret（密钥为空或写入失败），已取消拉取。`);
            return null;
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
            if (isSpecialVariant(model)) continue;
            const logical = assignRealModel(logicalModels(), model);
            if (!entry.mappings.some(mapping => mapping.realModel === model)) {
                entry.mappings.push({ id: makeId('mapping'), realModel: model, logicalModelId: logical.id, weight: 1 });
            }
        }
        reconcileEntryMappings(entry, models);
        applyMappingRules(groups(), mappingRules());
        pruneOrphanLogicalModels(logicalModels(), groups(), mappingRules().map(rule => rule.logicalModelId));
        saveSettingsNow();
        return models;
    } catch (error) {
        console.error('[QuickerApi] fetch vendor models failed:', error);
        const message = error instanceof Error ? error.message : String(error);
        if (!opts.quiet) toastr.error(`Key「${entry.label || 'Key'}」（Vendor「${vendor.name}」）获取模型失败：${message}。`);
        return null;
    } finally {
        if (previousActiveId) {
            await rotateSecretVerified(secretKey, previousActiveId);
        } else {
            await ensureEmptySecret(secretKey);
        }
    }
}