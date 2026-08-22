// 右栏：路由标签页（设置、分组、模型管理、导入导出）。
// 纯渲染函数，由 console-panel.ts 调用。

import { POPUP_TYPE, Popup } from '@sillytavern/scripts/popup';
import { groups, logicalModels, mappingRules, routingSettings, settings, vendors } from '../../settings/access.js';
import {
    applyMappingRules,
    buildLogicalModelsFromFetched,
    normalizeGroup,
    normalizeLogicalModel,
    pruneOrphanLogicalModels,
    resetModelData,
    buildModelListText,
    mergeImportedRoutingConfig,
    sanitizeGroupForExport,
    sortedLogicalModels,
} from '../../domain/vendor.js';
import { normalizeRoutingSettings } from '../../constants.js';
import { showEditorDialog } from './controls.js';
import { exportDebugLog } from '../../debug.js';
import { clearQuickApiSecrets } from '../../secrets/api.js';
import { escapeHtml } from '../../utils/text.js';
import { makeId } from '../../utils/id.js';
import { activeGroup, cslField, cslCheckbox, cslNumber, saveSettingsNow } from './console-helpers.js';
import type { Group } from '../../types.js';

/** 渲染"路由"标签页到 rightEl 容器。 */
export function renderRightRoute(
    rightEl: JQuery<HTMLElement> | null,
    onRefreshDashboard: () => void,
    onRefreshVendor: () => void,
): void {
    if (!rightEl) return;
    rightEl.empty();

    // ── 分组切换 ──
    const groupSection = $('<div class="csl-route-group-section"></div>');
    const groupLabel = $('<span class="csl-route-group-label">').text('当前分组：');
    const groupSelect = $('<select class="text_pole" style="min-width: 120px;"></select>');
    for (const g of groups()) {
        groupSelect.append($('<option>').val(g.id).text(g.name));
    }
    const currentGroup = activeGroup();
    if (currentGroup) groupSelect.val(currentGroup.id);
    groupSelect.on('change', function () {
        const newId = String($(this).val() || '');
        settings().activeGroupId = newId;
        saveSettingsNow();
        onRefreshDashboard();
        onRefreshVendor();
    });
    groupSection.append(groupLabel, groupSelect);
    rightEl.append(groupSection);

    // 路由开关
    const routing = routingSettings();
    const rows = $('<div class="csl-settings-group"></div>');
    rows.append(cslField('启用路由', cslCheckbox(routing.enabled, v => {
        routing.enabled = v;
        saveSettingsNow();
        toastr.info(`路由已${v ? '启用' : '停用'}。`);
    })));
    rows.append(cslField('保持同一 Vendor（次）', cslNumber(routing.stickyCount, v => {
        routing.stickyCount = v;
        saveSettingsNow();
    }, { min: 0, max: 10 })));
    rows.append(cslField('失败阈值', cslNumber(routing.failThreshold, v => {
        routing.failThreshold = v;
        saveSettingsNow();
    }, { min: 1, max: 20 }), '连续失败多少次进入冷却；≥1'));
    rows.append(cslField('冷却时间（秒）', cslNumber(routing.cooldownSeconds, v => {
        routing.cooldownSeconds = v;
        saveSettingsNow();
    }, { min: 1, max: 86400 }), '≥1'));
    rows.append(cslField('自动重试次数', cslNumber(routing.autoRetryCount, v => {
        routing.autoRetryCount = v;
        saveSettingsNow();
    }, { min: 0, max: 10 }), '失败或空回复时自动换路由重试（每次附加 0～500ms 随机抖动）；0 = 关闭，达到次数后停止'));
    rows.append(cslField('重试延迟（毫秒）', cslNumber(routing.autoRetryDelayMs, v => {
        routing.autoRetryDelayMs = v;
        saveSettingsNow();
    }, { min: 0, max: 60000 }), '失败后等待该时长再触发重试（附加 0～500ms 抖动）；等待期间若出现自动生成（群聊自动模式/脚本），会直接接管本次重试'));

    // 分组选择
    const group = activeGroup();
    if (group) {
        rows.append($('<div class="csl-section-title">').text('当前分组'));
        const groupRow = $('<div class="csl-field"></div>');
        groupRow.append($('<span class="csl-field-label">').text(group.name));
        const editGroupBtn = $('<button class="csl-btn csl-btn--icon" type="button" title="编辑分组"><i class="fa-solid fa-pen"></i></button>')
            .on('click', () => openGroupEditor(group, onRefreshDashboard, onRefreshVendor));
        groupRow.append(editGroupBtn);
        rows.append(groupRow);
    }

    // 模型管理（批量刷新已移到 Vendor 标签页顶部）
    rows.append($('<div class="csl-section-title">').text('模型管理'));
    const modelRow = $('<div class="csl-field" style="gap:4px"></div>');
        const buildLogicalBtn = $('<button class="csl-btn csl-btn--primary" type="button" title="为每个已拉取的真实模型单独创建逻辑模型并自动映射"><i class="fa-solid fa-wand-magic-sparkles"></i><span>从已拉取模型创建</span></button>')
        .on('click', () => {
            const allModels: string[] = [];
            for (const g of groups()) {
                for (const entry of g.entries) {
                    for (const model of entry.fetchedModels) allModels.push(model);
                }
            }
            if (allModels.length === 0) {
                toastr.info('还没有已拉取的模型。先在 Vendor 标签页拉取模型，再回来创建逻辑模型。');
                return;
            }
            if (!window.confirm(`将为 ${allModels.length} 个已拉取模型创建/归并逻辑模型，并重新应用映射规则、回收未引用的孤儿逻辑模型。继续？`)) return;
            const { created, skipped, mapped, rebuilt } = buildLogicalModelsFromFetched(allModels, logicalModels(), groups());
            const reapplied = applyMappingRules(groups(), mappingRules());
            const pruned = pruneOrphanLogicalModels(logicalModels(), groups(), mappingRules().map(rule => rule.logicalModelId));
            if (created.length === 0 && mapped === 0 && rebuilt === 0 && reapplied === 0 && pruned.length === 0) {
                toastr.info(skipped.length > 0 ? `无新模型可创建（${skipped.length} 个搜索/思考/图像/缓存变体已跳过）。` : '逻辑模型已是最新，无需创建。');
                return;
            }
            saveSettingsNow();
            onRefreshDashboard();
            onRefreshVendor();
            const parts = [`已为 ${created.length} 个真实模型创建独立逻辑模型`];
            if (mapped > 0) parts.push(`自动映射 ${mapped} 条`);
            if (rebuilt > 0) parts.push(`修正归并 ${rebuilt} 条`);
            if (reapplied > 0) parts.push(`重新应用规则 ${reapplied} 条`);
            if (pruned.length > 0) parts.push(`回收孤儿逻辑模型 ${pruned.length} 个`);
            if (skipped.length > 0) parts.push(`跳过 ${skipped.length} 个特殊变体`);
            toastr.success(`${parts.join('，')}。`);
        });
    const addLogicalBtn = $('<button class="csl-btn csl-btn--secondary" type="button" title="手动添加逻辑模型"><i class="fa-solid fa-plus"></i><span>添加逻辑模型</span></button>')
        .on('click', () => {
            const content = $('<div class="csl-editor"></div>');
            const nameInput = $('<input class="text_pole" type="text" maxlength="120" placeholder="逻辑模型名称，如：DeepSeek 系">');
            content.append(
                $('<div class="csl-empty">').text('逻辑模型是你在分组里选的"模型名"；多个 Vendor 的真实模型名可归并到同一个逻辑模型。'),
                cslField('名称', nameInput),
            );
            showEditorDialog({
                title: '添加逻辑模型',
                content,
                onSave: () => {
                    const name = String(nameInput.val() ?? '').trim().slice(0, 120);
                    if (!name) { toastr.warning('请填写逻辑模型名称。'); return false; }
                    const normalized = normalizeLogicalModel({ name });
                    logicalModels().push(normalized);
                    saveSettingsNow();
                    onRefreshDashboard();
                    onRefreshVendor();
                },
                successMessage: `逻辑模型「${nameInput.val()}」已添加。`,
            });
        });
    modelRow.append(buildLogicalBtn, addLogicalBtn);
    rows.append(modelRow);

    // 数据管理
    rows.append($('<div class="csl-section-title">').text('数据管理'));
    const exportRow = $('<div class="csl-field" style="gap:4px"></div>');
    const exportBtn = $('<button class="csl-btn csl-btn--secondary" type="button"><i class="fa-solid fa-file-export"></i><span>导出</span></button>')
        .on('click', () => exportData());
    const importBtn = $('<button class="csl-btn csl-btn--secondary" type="button"><i class="fa-solid fa-file-import"></i><span>导入</span></button>')
        .on('click', () => importData(onRefreshDashboard, onRefreshVendor));
    const exportModelsBtn = $('<button class="csl-btn csl-btn--secondary" type="button"><i class="fa-solid fa-download"></i><span>导出模型列表</span></button>')
        .on('click', () => exportModelList());
    const exportLogBtn = $('<button class="csl-btn csl-btn--secondary" type="button"><i class="fa-solid fa-file-lines"></i><span>导出日志</span></button>')
        .on('click', () => exportDebugLog());
    exportRow.append(exportBtn, importBtn, exportModelsBtn, exportLogBtn);
    rows.append(exportRow);

    // 危险操作
    const dangerRow = $('<div class="csl-field" style="gap:4px"></div>');
    const resetBtn = $('<button class="csl-btn csl-btn--danger" type="button"><i class="fa-solid fa-broom"></i><span>重置模型数据</span></button>')
        .on('click', async () => {
            const vendorsData = vendors();
            const logicalCount = logicalModels().length;
            if (vendorsData.length === 0 && logicalCount === 0) {
                toastr.info('还没有可重置的数据。');
                return;
            }
            const confirmed = await Popup.show.confirm(
                '重置模型数据',
                `将删除全部逻辑模型（${logicalCount} 个）、所有 Key 的模型映射与已拉取列表。此操作不可撤销，确定继续？`,
            );
            if (!confirmed) return;
            const stats = resetModelData(logicalModels(), groups());
            saveSettingsNow();
            onRefreshVendor();
            onRefreshDashboard();
            toastr.success(`已删除 ${stats.removedLogicalModels} 个逻辑模型、${stats.removedMappings} 条映射。`);
        });
    const clearSecretsBtn = $('<button class="csl-btn csl-btn--danger" type="button"><i class="fa-solid fa-trash"></i><span>清除 ST secret</span></button>')
        .on('click', async () => {
            const confirmed = await Popup.show.confirm(
                '清除 ST secret',
                '将删除 CUSTOM 与 DEEPSEEK 下所有 label 以「quicker-api:」开头的 secret 条目，各留一个空 active，并清空插件缓存的 secretId。此操作不可撤销，确定继续？',
            );
            if (!confirmed) return;
            try {
                const { deleted } = await clearQuickApiSecrets();
                for (const group of groups()) {
                    for (const entry of group.entries) entry.secretId = '';
                }
                saveSettingsNow();
                onRefreshVendor();
                toastr.success(`已清除 ${deleted} 个 quicker-api secret 条目。`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                toastr.error(`清除失败：${message}。`);
            }
        });
    dangerRow.append(resetBtn, clearSecretsBtn);
    rows.append(dangerRow);

    rightEl.append(rows);
}

function exportData(): void {
    const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        vendors: vendors(),
        logicalModels: logicalModels(),
        groups: groups().map(sanitizeGroupForExport),
        activeGroupId: settings().activeGroupId,
        routing: routingSettings(),
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
}

function importData(onRefreshDashboard: () => void, onRefreshVendor: () => void): void {
    const input = $('<input type="file" accept=".json,application/json">');
    input.on('change', async function () {
        const file = (this as HTMLInputElement).files?.[0];
        if (!file) return;
        let parsed: any;
        try {
            parsed = JSON.parse(await file.text());
        } catch (error) {
            toastr.error(`导入失败：${error instanceof Error ? error.message : String(error)}。`);
            return;
        }
        const importedVendors = Array.isArray(parsed?.vendors) ? parsed.vendors : [];
        const importedLogicalModels = Array.isArray(parsed?.logicalModels) ? parsed.logicalModels : [];
        const importedGroups = Array.isArray(parsed?.groups) ? parsed.groups : [];
        if (importedVendors.length === 0 && importedLogicalModels.length === 0 && importedGroups.length === 0) {
            toastr.warning('导入文件中没有 vendors/logicalModels/groups 数据，已取消。');
            return;
        }
        const extras: string[] = [];
        if (parsed?.routing && typeof parsed.routing === 'object') extras.push('覆盖当前路由设置');
        if (typeof parsed?.activeGroupId === 'string') extras.push('切换当前分组');
        const confirmed = await Popup.show.confirm(
            '导入路由配置',
            `将按 id 合并：Vendor ${importedVendors.length} 个、逻辑模型 ${importedLogicalModels.length} 个、分组 ${importedGroups.length} 个`
            + (extras.length ? `；${extras.join('，')}` : '')
            + '。确定继续？',
        );
        if (!confirmed) return;
        try {
            const merged = mergeImportedRoutingConfig({
                vendors: vendors(),
                logicalModels: logicalModels(),
                groups: groups(),
            }, {
                vendors: importedVendors,
                logicalModels: importedLogicalModels,
                groups: importedGroups,
            });
            const v = vendors();
            const l = logicalModels();
            const g = groups();
            v.splice(0, v.length, ...merged.vendors);
            l.splice(0, l.length, ...merged.logicalModels);
            g.splice(0, g.length, ...merged.groups);
            if (parsed?.routing && typeof parsed.routing === 'object') {
                Object.assign(routingSettings(), normalizeRoutingSettings(parsed.routing));
            }
            if (typeof parsed?.activeGroupId === 'string' && g.some(group => group.id === parsed.activeGroupId)) {
                settings().activeGroupId = parsed.activeGroupId;
            }
            saveSettingsNow();
            onRefreshVendor();
            onRefreshDashboard();
            toastr.success(`已导入配置：Vendor ${merged.vendors.length} 个、逻辑模型 ${merged.logicalModels.length} 个、分组 ${merged.groups.length} 个（按 id 合并）。`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toastr.error(`导入失败：${message}。`);
        }
    });
    input.trigger('click');
}

function exportModelList(): void {
    const text = buildModelListText(groups());
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
}

function openGroupEditor(group: Group, onRefreshDashboard: () => void, onRefreshVendor: () => void): void {
    const draft = normalizeGroup(structuredClone(group));
    const content = $('<div class="csl-editor"></div>');
    const nameInput = $('<input class="text_pole" type="text" maxlength="120" placeholder="分组名称，如：日常 / 深挖">').val(draft.name);
    const enabledCheck = $('<input type="checkbox">').prop('checked', draft.enabled);
    const logicalSelect = $('<select class="text_pole"></select>');
    for (const model of sortedLogicalModels(logicalModels())) logicalSelect.append($('<option>').val(model.id).text(model.name));
    logicalSelect.val(draft.currentLogicalModelId);

    const entryList = $('<div class="csl-entry-list"></div>');
    const vendorOptions = () => vendors().map(v => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.name)}</option>`).join('');
    const renderEntries = () => {
        entryList.empty();
        for (const entry of draft.entries) {
            const row = $('<div class="csl-entry-row"></div>');
            const vendorSelect = $('<select class="text_pole"></select>').html(`<option value="">— 选择 Vendor —</option>${vendorOptions()}`).val(entry.vendorId);
            const labelInput = $('<input class="text_pole" type="text" maxlength="120" placeholder="名称，如：主号 / 备用">').val(entry.label);
            const keyInput = $('<input class="text_pole" type="password" maxlength="2048" autocomplete="off" placeholder="Key">').val(entry.apiKey);
            const keyWeight = $('<input class="text_pole" type="number" min="0.01" step="0.1" title="Key 权重：同一 Vendor 内的相对概率" aria-label="Key 权重">').val(entry.weight ?? 1);
            const enabled = $('<input type="checkbox">').prop('checked', entry.enabled);
            vendorSelect.on('change', function () { entry.vendorId = String($(this).val() || ''); });
            labelInput.on('input', function () { entry.label = String($(this).val() ?? '').trim() || 'Key'; });
            keyInput.on('input', function () { entry.apiKey = String($(this).val() ?? '').trim(); entry.secretId = ''; });
            keyWeight.on('change', function () {
                const value = Number($(this).val());
                entry.weight = Number.isFinite(value) && value > 0 ? value : 1;
                $(this).val(entry.weight);
            });
            enabled.on('change', function () { entry.enabled = $(this).prop('checked'); });
            const removeBtn = $('<button class="menu_button quicker-api__delete-button" type="button" title="删除条目"><i class="fa-solid fa-trash"></i></button>')
                .on('click', () => {
                    draft.entries = draft.entries.filter(item => item.id !== entry.id);
                    renderEntries();
                });
            row.append(vendorSelect, labelInput, keyInput, keyWeight, enabled, removeBtn);
            entryList.append(row);
        }
    };
    renderEntries();
    const addEntryBtn = $('<button class="menu_button" type="button"><i class="fa-solid fa-plus"></i><span>添加 Vendor + Key</span></button>')
        .on('click', () => {
            draft.entries.push({ id: makeId('group-entry'), vendorId: '', apiKey: '', label: 'Key', enabled: true, weight: 1, fetchedModels: [], mappings: [] });
            renderEntries();
        });

    content.append(
        cslField('名称', nameInput, '分组名称，如"日常"、"深挖"，仅用于区分环境'),
        cslField('当前逻辑模型', logicalSelect, '该分组路由时使用的模型；也可在主面板点击逻辑模型快捷切换'),
        $('<label class="checkbox_label"></label>').append(enabledCheck, ' 启用（该分组参与路由）'),
        cslField('Vendor + Key 条目', $('<div></div>').append(entryList, addEntryBtn), '每个条目 = 一个可用 Key；选 Vendor、填 Key；同一 Vendor 可多条（多条会一起参与随机，且共享该 Vendor 的 RPM 限制）'),
    );

    showEditorDialog({
        title: `编辑分组「${draft.name}」`,
        content,
        large: true,
        onSave: () => {
            draft.name = String(nameInput.val() ?? '').trim().slice(0, 120) || '分组';
            draft.enabled = enabledCheck.prop('checked');
            draft.currentLogicalModelId = String(logicalSelect.val() || '');
            Object.assign(group, normalizeGroup(draft));
            saveSettingsNow();
            onRefreshVendor();
            onRefreshDashboard();
        },
        successMessage: `分组「${draft.name}」已保存。`,
    });
}