// 右栏：映射标签页（映射规则 / 忽略清单 / 一键归类）。
// 纯渲染函数，由 console-panel.ts 调用。

import { POPUP_TYPE, Popup } from '@sillytavern/scripts/popup';
import { showEditorDialog } from './controls.js';
import { makeId } from '../../utils/id.js';
import { escapeHtml } from '../../utils/text.js';
import {
    addIgnoreModel,
    applyMappingRule,
    applyMappingRules,
    assignModelToLogical,
    buildLogicalModelsFromFetched,
    findUnmappedModels,
    normalizeLogicalModel,
    normalizeMappingRule,
    previewMappingRule,
    pruneOrphanLogicalModels,
    removeIgnoreModel,
    specialVariantModels,
} from '../../domain/vendor.js';
import { groups, logicalModels, mappingRules, settings } from '../../settings/access.js';
import { saveSettingsNow, cslField } from './console-helpers.js';
import type { MappingRule } from '../../types.js';

/** 渲染"映射"标签页到 rightEl 容器。 */
export function renderRightMapping(
    rightEl: JQuery<HTMLElement> | null,
    onRefreshDashboard: () => void,
): void {
    if (!rightEl) return;
    const topBar = $('<div class="csl-mapping-topbar"></div>');
    const oneClickBtn = $('<button class="csl-btn csl-btn--primary" type="button" title="按核心名一键归类所有未映射真实模型，跳过特殊变体"><i class="fa-solid fa-wand-magic-sparkles"></i><span>一键归类全部</span></button>')
        .on('click', async () => {
            const allModels: string[] = [];
            for (const group of groups()) {
                for (const entry of group.entries) {
                    for (const model of entry.fetchedModels) allModels.push(model);
                }
            }
            if (allModels.length === 0) {
                toastr.info('还没有已拉取的模型，无法归类。');
                return;
            }
            const confirmed = await Popup.show.confirm(
                '一键归类全部',
                `将按核心名归类 ${allModels.length} 个已拉取模型（跳过特殊变体），重放映射规则，并回收未引用的孤儿逻辑模型。继续？`,
            );
            if (!confirmed) return;
            const { created, mapped, skipped } = buildLogicalModelsFromFetched(allModels, logicalModels(), groups());
            const reapplied = applyMappingRules(groups(), mappingRules());
            const pruned = pruneOrphanLogicalModels(logicalModels(), groups(), mappingRules().map(rule => rule.logicalModelId));
            renderUnmapped();
            saveSettingsNow();
            onRefreshDashboard();
            const parts: string[] = [];
            if (mapped > 0) parts.push(`归类 ${mapped} 个`);
            if (reapplied > 0) parts.push(`重新应用规则 ${reapplied} 条`);
            if (created.length > 0) parts.push(`创建 ${created.length} 个逻辑模型`);
            if (pruned.length > 0) parts.push(`回收 ${pruned.length} 个孤儿子逻辑模型`);
            toastr.success(parts.length > 0 ? `一键归类完成：${parts.join('，')}。` : '没有未归类的模型。');
        });
    topBar.append(oneClickBtn);
    rightEl.append(topBar);

    // ── 批量映射规则（添加规则 / 添加逻辑模型） ──
    const ruleSection = $('<div class="csl-mapping-section"></div>');
    ruleSection.append($('<div class="csl-mapping-section-title">').text('批量映射规则'));
    const ruleList = $('<div class="csl-mapping-rules"></div>');
    renderRules(ruleList);
    ruleSection.append(ruleList);

    const addBtnRow = $('<div style="display:flex;gap:6px;margin-top:6px"></div>');
    const addRuleBtn = $('<button class="csl-btn csl-btn--secondary" type="button"><i class="fa-solid fa-plus"></i><span>添加规则</span></button>')
        .on('click', () => {
            openRuleEditor(null, () => renderRules(ruleList));
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
                    logicalModels().push(normalizeLogicalModel({ name }));
                    saveSettingsNow();
                    onRefreshDashboard();
                    renderUnmapped();
                },
                successMessage: () => `逻辑模型「${String(nameInput.val() ?? '').trim()}」已添加。`,
            });
        });
    addBtnRow.append(addRuleBtn, addLogicalBtn);
    ruleSection.append(addBtnRow);
    rightEl.append(ruleSection);

    // ── 未归类真实模型（头部折叠） ──
    const unmappedSection = $('<div class="csl-mapping-section"></div>');
    const unmappedList = $('<div class="csl-mapping-unmapped"></div>');
    let unmappedOpen = false;
    const renderUnmapped = () => {
        unmappedList.empty();
        const models = findUnmappedModels(groups());
        if (models.length === 0) {
            updateUnmappedHead();
            unmappedList.append($('<div class="csl-mapping-empty">').text('没有未归类的真实模型。'));
            return;
        }
        updateUnmappedHead();
        for (const realModel of models) {
            const row = $('<div class="csl-mapping-unmapped-row"></div>');
            const select = $('<select class="text_pole"></select>').append($('<option value="">').text('— 选择逻辑模型 —'));
            for (const model of logicalModels()) select.append($('<option>').val(model.id).text(model.name));
            const apply = $('<button class="csl-btn csl-btn--icon" type="button" title="映射到所选逻辑模型"><i class="fa-solid fa-link"></i></button>')
                .on('click', () => {
                    const logicalModelId = String(select.val() || '');
                    if (!logicalModelId) { toastr.warning('请选择目标逻辑模型。'); return; }
                    const target = logicalModels().find(model => model.id === logicalModelId);
                    if (!target) return;
                    const touched = assignModelToLogical(groups(), realModel, logicalModelId);
                    saveSettingsNow();
                    renderUnmapped();
                    onRefreshDashboard();
                    toastr.success(`已将「${realModel}」映射到「${target.name}」，更新 ${touched} 个 Key。`);
                });
            row.append($('<code>').text(realModel), select, apply);
            unmappedList.append(row);
        }
    };
    const unmappedHead = $('<button class="csl-btn csl-btn--secondary csl-mapping-fold-head" type="button"></button>');
    /** 头部标签唯一写入点：始终按 unmappedOpen 与当前数量渲染；重渲染列表时不得回退文案。 */
    const updateUnmappedHead = (): void => {
        const count = findUnmappedModels(groups()).length;
        const suffix = count > 0 ? `（${count}）` : '';
        unmappedHead.html(`<i class="fa-solid ${unmappedOpen ? 'fa-chevron-down' : 'fa-chevron-right'}"></i><span>${unmappedOpen ? '收起' : '显示'}未归类模型${suffix}</span>`);
    };
    updateUnmappedHead();
    unmappedHead.on('click', () => {
        unmappedOpen = !unmappedOpen;
        if (unmappedOpen) {
            renderUnmapped();
            unmappedList.show();
        } else {
            unmappedList.hide();
        }
        updateUnmappedHead();
    });
    unmappedList.hide();
    unmappedSection.append(unmappedHead, unmappedList);
    rightEl.append(unmappedSection);

    // ── 忽略清单（头部折叠） ──
    const ignoreSection = $('<div class="csl-mapping-section"></div>');
    const ignoreList = $('<div class="csl-mapping-ignored"></div>');
    let ignoreOpen = false;
    const renderIgnored = () => {
        ignoreList.empty();
        const ignored = settings().ignoredModels ?? [];
        const autoIgnored = specialVariantModels(groups());
        if (ignored.length === 0 && autoIgnored.length === 0) {
            ignoreList.append($('<div class="csl-mapping-empty">').text('没有忽略的模型。'));
            return;
        }
        if (autoIgnored.length > 0) {
            ignoreList.append($('<div class="csl-mapping-ignored-label">').text('自动忽略（特殊变体）：'));
            const autoWrap = $('<div class="csl-mapping-ignored-pills"></div>');
            for (const name of autoIgnored) {
                autoWrap.append($('<span class="csl-mapping-ignore-pill csl-mapping-ignore-pill--auto">').text(name));
            }
            ignoreList.append(autoWrap);
        }
        if (ignored.length > 0) {
            ignoreList.append($('<div class="csl-mapping-ignored-label">').text('手动忽略：'));
            const manualWrap = $('<div class="csl-mapping-ignored-pills"></div>');
            for (const name of ignored) {
                const pill = $('<span class="csl-mapping-ignore-pill"></span>');
                pill.append(document.createTextNode(name));
                const unignore = $('<span class="csl-mapping-unignore" role="button" title="取消忽略"><i class="fa-solid fa-xmark"></i></span>')
                    .on('click', () => {
                        settings().ignoredModels = removeIgnoreModel(settings().ignoredModels, name);
                        saveSettingsNow();
                        renderIgnored();
                    });
                pill.append(unignore);
                manualWrap.append(pill);
            }
            ignoreList.append(manualWrap);
        }
    };
    const ignoreHeadBtn = $('<button class="csl-btn csl-btn--secondary csl-mapping-fold-head" type="button"></button>');
    ignoreHeadBtn.on('click', () => {
        ignoreOpen = !ignoreOpen;
        if (ignoreOpen) renderIgnored();
        ignoreList.toggle(ignoreOpen);
        ignoreHeadBtn.html(`<i class="fa-solid ${ignoreOpen ? 'fa-chevron-down' : 'fa-chevron-right'}"></i><span>${ignoreOpen ? '收起忽略清单' : '显示忽略清单'}</span>`);
    });
    ignoreHeadBtn.html('<i class="fa-solid fa-chevron-right"></i><span>显示忽略清单</span>');
    renderIgnored();
    ignoreList.hide();
    ignoreSection.append(ignoreHeadBtn, ignoreList);
    rightEl.append(ignoreSection);

    // ── 提示 ──
    rightEl.append($('<div class="csl-mapping-hint">').text('批量规则持久化保存；匹配正则作用域为所有 Key 已拉取的真实模型。'));
}

function renderRules(ruleList: JQuery<HTMLElement>): void {
    ruleList.empty();
    const rules = mappingRules();
    if (rules.length === 0) {
        ruleList.append($('<div class="csl-mapping-empty">').text('还没有批量映射规则。规则可按正则把多个真实模型一次性映射到目标逻辑模型。'));
        return;
    }
    for (const rule of rules) {
        const row = $('<div class="csl-mapping-rule-row"></div>');
        row.append($('<code>').text(`/${rule.pattern}/i`));
        const targetName = logicalModels().find(m => m.id === rule.logicalModelId)?.name || '(已删除)';
        row.append($('<span class="csl-mapping-rule-target">').text(`→ ${targetName}`));
        const acts = $('<div class="csl-mapping-rule-actions"></div>');
        const reapply = $('<button class="csl-btn csl-btn--icon" type="button" title="立即按此规则重新映射"><i class="fa-solid fa-bolt"></i></button>').on('click', () => {
            const touched = applyMappingRule(groups(), rule);
            saveSettingsNow();
            toastr.success(`规则「/${rule.pattern}/i」已应用，更新 ${touched} 条映射。`);
        });
        const edit = $('<button class="csl-btn csl-btn--icon" type="button" title="编辑"><i class="fa-solid fa-pen"></i></button>').on('click', () => {
            openRuleEditor(rule, () => renderRules(ruleList));
        });
        const remove = $('<button class="csl-btn csl-btn--icon csl-btn--danger" type="button" title="删除规则"><i class="fa-solid fa-trash"></i></button>').on('click', async () => {
            const confirmed = await Popup.show.confirm('删除规则', `删除规则「/${rule.pattern}/i」？已建立的映射不会被撤销。`);
            if (!confirmed) return;
            const rulesArr = mappingRules();
            const index = rulesArr.findIndex(item => item.id === rule.id);
            if (index >= 0) rulesArr.splice(index, 1);
            saveSettingsNow();
            renderRules(ruleList);
        });
        acts.append(reapply, edit, remove);
        row.append(acts);
        ruleList.append(row);
    }
}

function openRuleEditor(existing: MappingRule | null, onDone: () => void): void {
    const draft = existing ? normalizeMappingRule(structuredClone(existing)) : { id: '', pattern: '', logicalModelId: '' };
    const content = $('<div class="csl-editor"></div>');
    const patternInput = $('<input class="text_pole" type="text" maxlength="500" placeholder="正则，如：kimi|k3">').val(draft.pattern);
    const logicalSelect = $('<select class="text_pole"></select>');
    logicalSelect.append($('<option value="">— 选择逻辑模型 —</option>'));
    for (const model of logicalModels()) {
        logicalSelect.append($('<option>').val(model.id).text(model.name));
    }
    const previewRow = $('<div class="csl-mapping-preview"></div>');
    const updatePreview = () => {
        const { names, count } = previewMappingRule(groups(), String(patternInput.val() || ''));
        previewRow.empty();
        if (count === 0) {
            previewRow.text('未匹配到任何已拉取模型。');
            return;
        }
        const shown = names.slice(0, 6).map(name => escapeHtml(name)).join('，');
        previewRow.html(`将影响 <strong>${count}</strong> 个模型${names.length > 6 ? '（显示前 6 个）' : ''}：${shown}`);
    };
    patternInput.on('input', updatePreview);
    updatePreview();

    content.append(
        $('<div style="font-size:12px;color:#999;padding:4px 0 2px">').text('匹配正则（真实模型名，大小写不敏感）'),
        patternInput,
        $('<div style="font-size:12px;color:#999;padding:8px 0 2px">').text('目标逻辑模型'),
        logicalSelect,
        previewRow,
    );

    const doSave = (applyNow: boolean): boolean => {
        const pattern = String(patternInput.val() ?? '').trim();
        if (!pattern) { toastr.warning('请填写匹配正则。'); return false; }
        const logicalModelId = String(logicalSelect.val() || '');
        if (!logicalModelId) { toastr.warning('请选择目标逻辑模型。'); return false; }
        let rule: MappingRule;
        const rules = mappingRules();
        if (existing) {
            rule = { ...draft, pattern, logicalModelId };
            const index = rules.findIndex(item => item.id === existing.id);
            if (index >= 0) rules[index] = rule;
        } else {
            rule = normalizeMappingRule({ id: makeId('mapping-rule'), pattern, logicalModelId });
            rules.push(rule);
        }
        let touched = 0;
        if (applyNow) touched = applyMappingRule(groups(), rule);
        toastr.success(existing ? '规则已更新。' : `规则已保存${applyNow ? `并应用，更新 ${touched} 条映射` : ''}。`);
        return true;
    };
    showEditorDialog({
        title: existing ? '编辑映射规则' : '添加映射规则',
        content,
        onSave: () => doSave(false),
        onShown: () => {
            logicalSelect.select2({
                placeholder: '— 选择逻辑模型 —',
                searchInputPlaceholder: '搜索逻辑模型…',
                searchInputCssClass: 'text_pole',
                width: '100%',
            });
        },
        extraActions: [
            {
                label: '保存并应用',
                icon: 'fa-bolt',
                title: '保存并立即映射',
                onClick: () => doSave(true),
            },
        ],
    });
}

