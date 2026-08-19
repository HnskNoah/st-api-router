// 右栏：映射标签页（映射规则 / 忽略清单 / 一键归类）。
// 纯渲染函数，由 console-panel.ts 调用。

import { POPUP_TYPE, Popup } from '@sillytavern/scripts/popup';
import { showEditorDialog } from './controls.js';
import { makeId } from '../../utils/id.js';
import { escapeHtml } from '../../utils/text.js';
import {
    addIgnoreModel,
    applyMappingRule,
    buildLogicalModelsFromFetched,
    normalizeMappingRule,
    previewMappingRule,
    pruneOrphanLogicalModels,
    removeIgnoreModel,
    specialVariantModels,
} from '../../domain/vendor.js';
import { groups, logicalModels, mappingRules, settings } from '../../settings/access.js';
import { saveSettingsNow } from './console-helpers.js';
import type { MappingRule } from '../../types.js';

/** 渲染"映射"标签页到 rightEl 容器。 */
export function renderRightMapping(
    rightEl: JQuery<HTMLElement> | null,
    onRefreshDashboard: () => void,
): void {
    if (!rightEl) return;
    rightEl.empty();

    // ── 一键归类按钮 ──
    const topBar = $('<div class="csl-mapping-topbar"></div>');
    const oneClickBtn = $('<button class="menu_button" type="button" title="按核心名一键归类所有未映射真实模型，跳过特殊变体"><i class="fa-solid fa-wand-magic-sparkles"></i><span>一键归类全部</span></button>')
        .on('click', () => {
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
            const { created, mapped, skipped } = buildLogicalModelsFromFetched(allModels, logicalModels(), groups());
            const pruned = pruneOrphanLogicalModels(logicalModels(), groups());
            saveSettingsNow();
            onRefreshDashboard();
            const parts: string[] = [];
            if (mapped > 0) parts.push(`归类 ${mapped} 个`);
            if (created.length > 0) parts.push(`创建 ${created.length} 个逻辑模型`);
            if (pruned.length > 0) parts.push(`回收 ${pruned.length} 个孤儿子逻辑模型`);
            if (skipped.length > 0) parts.push(`跳过 ${skipped.length} 个特殊变体`);
            toastr.success(parts.length > 0 ? `一键归类完成：${parts.join('，')}。` : '没有未归类的模型。');
        });
    topBar.append(oneClickBtn);
    rightEl.append(topBar);

    // ── 规则列表 ──
    const ruleSection = $('<div class="csl-mapping-section"></div>');
    ruleSection.append($('<div class="csl-mapping-section-title">').text('批量映射规则'));
    const ruleList = $('<div class="csl-mapping-rules"></div>');
    renderRules(ruleList);
    ruleSection.append(ruleList);

    const addRuleBtn = $('<button class="menu_button" type="button" style="margin-top:6px"><i class="fa-solid fa-plus"></i><span>添加规则</span></button>')
        .on('click', () => {
            openRuleEditor(null, () => renderRules(ruleList));
        });
    ruleSection.append(addRuleBtn);
    rightEl.append(ruleSection);

    // ── 忽略清单 ──
    const ignoreSection = $('<div class="csl-mapping-section"></div>');
    const ignoreHead = $('<div class="csl-mapping-section-title"></div>').text('忽略清单');
    ignoreSection.append(ignoreHead);
    const ignoreList = $('<div class="csl-mapping-ignored"></div>');
    let ignoreVisible = false;
    const renderIgnored = () => {
        ignoreList.empty();
        const ignored = settings().ignoredModels ?? [];
        const autoIgnored = specialVariantModels(groups());
        if (ignored.length === 0 && autoIgnored.length === 0) {
            ignoreList.append($('<div class="csl-mapping-empty">').text('没有忽略的模型。'));
            return;
        }
        if (autoIgnored.length > 0) {
            const autoLabel = $('<div class="csl-mapping-ignored-label">').text('自动忽略（特殊变体）：');
            ignoreList.append(autoLabel);
            const autoWrap = $('<div class="csl-mapping-ignored-pills"></div>');
            for (const name of autoIgnored) {
                autoWrap.append($('<span class="csl-mapping-ignore-pill csl-mapping-ignore-pill--auto">').text(name));
            }
            ignoreList.append(autoWrap);
        }
        if (ignored.length > 0) {
            const manualLabel = $('<div class="csl-mapping-ignored-label">').text('手动忽略：');
            ignoreList.append(manualLabel);
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
    const toggleIgnoreBtn = $('<button class="menu_button" type="button" style="margin-top:6px"><span>显示忽略清单</span></button>')
        .on('click', function () {
            ignoreVisible = !ignoreVisible;
            $(this).find('span').text(ignoreVisible ? '隐藏忽略清单' : '显示忽略清单');
            if (ignoreVisible) {
                renderIgnored();
                ignoreList.show();
            } else {
                ignoreList.hide();
            }
        });
    ignoreSection.append(ignoreList, toggleIgnoreBtn);
    ignoreList.hide();
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
        const reapply = $('<button class="menu_button" type="button" title="立即按此规则重新映射"><i class="fa-solid fa-bolt"></i></button>').on('click', () => {
            const touched = applyMappingRule(groups(), rule);
            saveSettingsNow();
            toastr.success(`规则「/${rule.pattern}/i」已应用，更新 ${touched} 条映射。`);
        });
        const edit = $('<button class="menu_button" type="button" title="编辑"><i class="fa-solid fa-pen"></i></button>').on('click', () => {
            openRuleEditor(rule, () => renderRules(ruleList));
        });
        const remove = $('<button class="menu_button quicker-api__delete-button" type="button" title="删除规则"><i class="fa-solid fa-trash"></i></button>').on('click', async () => {
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
    if (draft.logicalModelId) logicalSelect.val(draft.logicalModelId);
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
        saveSettingsNow();
        onDone();
        toastr.success(existing ? '规则已更新。' : `规则已保存${applyNow ? `并应用，更新 ${touched} 条映射` : ''}。`);
        return true;
    };
    showEditorDialog({
        title: existing ? '编辑映射规则' : '添加映射规则',
        content,
        onSave: () => doSave(false),
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

