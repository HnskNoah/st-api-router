// 映射工具：手动批量映射规则 + 忽略管理 + 一键归类。
// 独立模块，降低 ui.ts 巨石；接收 RoutingUIDeps 与 render 回调，无反向依赖。

import { POPUP_TYPE, Popup } from '@sillytavern/scripts/popup';
import { makeId } from '../../utils/id.js';
import { escapeHtml } from '../../utils/text.js';
import {
    addIgnoreModel,
    applyMappingRule,
    buildLogicalModelsFromFetched,
    previewMappingRule,
    pruneOrphanLogicalModels,
    removeIgnoreModel,
    specialVariantModels,
    isIgnoreModel,
    normalizeMappingRule,
} from '../../domain/vendor.js';
import type { Group, LogicalModel, MappingRule } from '../../types.js';

export interface MappingToolsContext {
    getGroups(): Group[];
    getLogicalModels(): LogicalModel[];
    getMappingRules(): MappingRule[];
    getIgnoredModels(): string[];
    save(): void;
    /** 应用/忽略/归类后刷新面板（模型列表高亮等）。 */
    refresh(): void;
}

export function initMappingTools(root: JQuery<HTMLElement>, ctx: MappingToolsContext): void {
    const ruleList = root.find('#st_router_rule_list');
    const ignoredList = root.find('#st_router_ignored');
    const autoNewHint = root.find('#st_router_autonew_hint');

    let ignoredVisible = false;

    function logicalOptionsHtml(selectedId = ''): string {
        const options = ctx.getLogicalModels().map(model => `<option value="${escapeHtml(model.id)}"${model.id === selectedId ? ' selected' : ''}>${escapeHtml(model.name)}</option>`).join('');
        return `<option value="">— 选择逻辑模型 —</option>${options}`;
    }

    function logicalName(id: string): string {
        return ctx.getLogicalModels().find(model => model.id === id)?.name || '(已删除)';
    }

    function clearAndSave(): void {
        ctx.save();
        ctx.refresh();
    }

    // ── 规则列表 ──
    function renderRules(): void {
        ruleList.empty();
        const rules = ctx.getMappingRules();
        if (rules.length === 0) {
            ruleList.append($('<div class="st-router-empty--muted">').text('还没有批量映射规则。规则可按正则把多个真实模型一次性映射到目标逻辑模型（持久化，自动归类只作用于拉取时）。'));
            return;
        }
        for (const rule of rules) {
            const row = $('<div class="st-router-rule-row"></div>');
            row.append($('<code>').text(`/${rule.pattern}/i`));
            row.append($('<span class="st-router-rule-target">').text(`→ ${logicalName(rule.logicalModelId)}`));
            const acts = $('<div class="st-router-rule-actions"></div>');
            const reapply = $('<button class="menu_button" type="button" title="立即按此规则重新映射"><i class="fa-solid fa-bolt"></i></button>').on('click', () => {
                const touched = applyMappingRule(ctx.getGroups(), rule);
                clearAndSave();
                toastr.success(`规则「/${rule.pattern}/i」已应用，更新 ${touched} 条映射。`);
            });
            const edit = $('<button class="menu_button" type="button" title="编辑"><i class="fa-solid fa-pen"></i></button>').on('click', () => openRuleEditor(rule));
            const remove = $('<button class="menu_button quicker-api__delete-button" type="button" title="删除规则"><i class="fa-solid fa-trash"></i></button>').on('click', async () => {
                const confirmed = await Popup.show.confirm('删除规则', `删除规则「/${rule.pattern}/i」？已建立的映射不会被撤销。`);
                if (!confirmed) return;
                const rulesArr = ctx.getMappingRules();
                const index = rulesArr.findIndex(item => item.id === rule.id);
                if (index >= 0) rulesArr.splice(index, 1);
                clearAndSave();
            });
            acts.append(reapply, edit, remove);
            row.append(acts);
            ruleList.append(row);
        }
    }

    function openRuleEditor(existing?: MappingRule): void {
        const draft = existing ? normalizeMappingRule(structuredClone(existing)) : { id: '', pattern: '', logicalModelId: '' };
        const content = $('<div class="st-router-editor"></div>');
        const patternInput = $('<input class="text_pole" type="text" maxlength="500" placeholder="正则，如：kimi|k3">').val(draft.pattern);
        const logicalSelect = $('<select class="text_pole"></select>').html(logicalOptionsHtml(draft.logicalModelId));
        const previewRow = $('<div class="st-router-empty"></div>');
        const updatePreview = () => {
            const { names, count } = previewMappingRule(ctx.getGroups(), String(patternInput.val() || ''));
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
            $('<label class="quicker-api__field"><span>匹配正则（真实模型名，大小写不敏感）</span></label>'),
            patternInput,
            $('<label class="quicker-api__field"><span>目标逻辑模型</span></label>'),
            logicalSelect,
            previewRow,
        );
        const saveBtn = $('<button class="menu_button quicker-api__save-button" type="button"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></button>');
        const cancelBtn = $('<button class="menu_button" type="button"><span>取消</span></button>');
        const applyBtn = $('<button class="menu_button" type="button" title="保存并立即按此规则映射"><i class="fa-solid fa-bolt"></i><span>保存并应用</span></button>');
        const actions = $('<div class="st-router-editor-actions"></div>').append(applyBtn, saveBtn, cancelBtn);
        content.append(actions);
        const popup = new Popup(content, POPUP_TYPE.TEXT, '', { large: false, wide: true, okButton: false, cancelButton: false });

        const doSave = (applyNow: boolean) => {
            const pattern = String(patternInput.val() ?? '').trim();
            if (!pattern) { toastr.warning('请填写匹配正则。'); return; }
            const logicalModelId = String(logicalSelect.val() || '');
            if (!logicalModelId) { toastr.warning('请选择目标逻辑模型。'); return; }
            let rule: MappingRule;
            const rules = ctx.getMappingRules();
            if (existing) {
                rule = { ...draft, pattern, logicalModelId };
                const index = rules.findIndex(item => item.id === existing.id);
                if (index >= 0) rules[index] = rule;
            } else {
                rule = normalizeMappingRule({ id: makeId('mapping-rule'), pattern, logicalModelId });
                rules.push(rule);
            }
            let touched = 0;
            if (applyNow) touched = applyMappingRule(ctx.getGroups(), rule);
            clearAndSave();
            void popup.completeCancelled();
            toastr.success(existing ? '规则已更新。' : `规则已保存${applyNow ? `并应用，更新 ${touched} 条映射` : ''}。`);
        };
        saveBtn.on('click', () => doSave(false));
        applyBtn.on('click', () => doSave(true));
        cancelBtn.on('click', () => void popup.completeCancelled());
        void popup.show();
    }

    // ── 忽略清单 ──
    function renderIgnored(): void {
        ignoredList.empty();
        if (!ignoredVisible) {
            ignoredList.append($('<div class="st-router-empty--muted">').text('点击上方"显示忽略清单"查看已自动忽略与手动忽略的模型。'));
            return;
        }
        const auto = specialVariantModels(ctx.getGroups());
        const manual = ctx.getIgnoredModels();
        if (auto.length === 0 && manual.length === 0) {
            ignoredList.append($('<div class="st-router-empty--muted">').text('当前没有被忽略的模型（特殊变体：embedding/reranker/search/thinking/image/cache 自动忽略）。'));
            return;
        }
        // 手动忽略（无 dashed 边框）
        for (const name of manual) {
            const pill = $('<span class="st-router-ignore-pill"></span>');
            pill.append($('<span>').text(name));
            const un = $('<span class="unignore-btn" role="button" tabindex="0" title="取消忽略"><i class="fa-solid fa-rotate-left"></i></span>')
                .on('click', () => {
                    const remaining = removeIgnoreModel(ctx.getIgnoredModels(), name);
                    ctx.getIgnoredModels().splice(0, ctx.getIgnoredModels().length, ...remaining);
                    clearAndSave();
                });
            pill.append(un);
            ignoredList.append(pill);
        }
        // 自动忽略（dashed 边框，只展示）
        for (const name of auto) {
            if (isIgnoreModel(manual, name)) continue; // 手动清单里已有则不重复显示为自动
            const pill = $('<span class="st-router-ignore-pill st-router-ignore-pill--auto"></span>');
            pill.append($('<span>').text(`${name}（自动）`));
            ignoredList.append(pill);
        }
    }

    function renderAll(): void {
        renderRules();
        renderIgnored();
    }

    // ── 按钮绑定 ──
    root.find('#st_router_add_rule').on('click', () => openRuleEditor());
    root.find('#st_router_toggle_ignored').on('click', function () {
        ignoredVisible = !ignoredVisible;
        $(this).find('span').text(ignoredVisible ? '隐藏忽略清单' : '显示忽略清单');
        renderIgnored();
    });
    root.find('#st_router_map_oneclick').on('click', () => {
        const allModels: string[] = [];
        for (const group of ctx.getGroups()) {
            for (const entry of group.entries) {
                for (const model of entry.fetchedModels) allModels.push(model);
            }
        }
        if (allModels.length === 0) {
            toastr.info('还没有已拉取的模型。先为 Key 拉取模型，再一键归类。');
            return;
        }
        const { created, skipped, mapped, rebuilt } = buildLogicalModelsFromFetched(allModels, ctx.getLogicalModels(), ctx.getGroups());
        const pruned = pruneOrphanLogicalModels(ctx.getLogicalModels(), ctx.getGroups());
        clearAndSave();
        const parts = [`已归类 ${mapped} 条映射`];
        if (created.length > 0) parts.push(`创建 ${created.length} 个逻辑模型`);
        if (rebuilt > 0) parts.push(`修正归并 ${rebuilt} 条`);
        if (pruned.length > 0) parts.push(`回收孤儿 ${pruned.length} 个`);
        if (skipped.length > 0) parts.push(`跳过特殊变体 ${skipped.length} 个（已入忽略）`);
        toastr.success(`${parts.join('，')}。`);
        renderAll();
    });

    // 映射应用后可能改变分组当前逻辑模型指针高亮，刷新模型列表
    autoNewHint.text('批量规则持久化保存；匹配正则作用域为所有 Key 已拉取的真实模型。');
    renderAll();
}