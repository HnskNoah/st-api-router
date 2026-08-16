// 便捷方案管理界面（拆解自 manageQuickActions：draft / list / editor / commit）

import { saveSettingsDebounced } from '@sillytavern/script';
import { Popup, POPUP_TYPE } from '@sillytavern/scripts/popup';
import { runtimeState, ownedPopups } from '../state.js';
import { settings, providers, logicalModels } from '../settings/access.js';
import { normalizeQuickAction, normalizeQuickActionPlacement, normalizeQuickActionsForPersist, quickActionDisplayName } from '../domain/quick-action.js';
import { aggregateModels } from '../domain/model-catalog.js';
import { normalizeText, sanitizeName } from '../utils/text.js';
import { normalizeModelList } from '../utils/model-list.js';
import { makeId } from '../utils/id.js';
import { presetOptionsHtml } from './options.js';
import { ensureQuickActionEntries } from './menu.js';
import type { QuickAction, QuickActionPlacement } from '../types.js';

function ensureQuickManagerStyles(): void {
    if (document.getElementById('quicker-api-quick-manager-styles')) return;
    $('<style id="quicker-api-quick-manager-styles"></style>').text(`
        /* fixed 浮层：借鉴 preset-cards 的 pc-manager-container，避免 ST Popup 黑边/空白问题 */
        .quicker-api__quick-overlay {
            position: fixed; inset: 4vh 6vw; z-index: 99999;
            display: flex; align-items: stretch; justify-content: center;
        }
        .quicker-api__quick-manager {
            --qa-border: var(--SmartThemeBorderColor, rgba(128, 128, 128, 0.28));
            --qa-border-strong: rgba(128, 128, 128, 0.5);
            --qa-bg: color-mix(in srgb, var(--SmartThemeBodyColor) 5%, transparent);
            --qa-bg-hover: color-mix(in srgb, var(--SmartThemeBodyColor) 8%, transparent);
            --qa-accent: #5b9bd5;
            --qa-danger: #d9534f;
            --qa-text: var(--SmartThemeBodyColor, #e8e8e8);
            --qa-text-dim: color-mix(in srgb, var(--SmartThemeBodyColor) 70%, transparent);
            display: flex; flex-direction: column; gap: 10px;
            width: 100%; min-width: 0; min-height: 0;
            box-sizing: border-box;
            padding: 20px;
            background: var(--SmartThemeBlurTintColor, rgba(30, 30, 30, 0.85));
            backdrop-filter: blur(20px);
            border: 1px solid var(--qa-border); border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
            text-align: start;
            color: var(--qa-text); font-size: 13px;
        }
        .quicker-api__quick-header {
            display: flex; align-items: center; gap: 10px;
            padding: 10px 12px; border: 1px solid var(--qa-border); border-radius: 8px;
            background: var(--qa-bg); flex-wrap: wrap;
        }
        .quicker-api__quick-title {
            display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600;
            flex: 1 1 auto; min-width: 180px;
        }
        .quicker-api__quick-title i { color: var(--qa-accent); }
        .quicker-api__quick-header-actions { display: flex; align-items: center; gap: 6px; }
        .quicker-api__quick-columns {
            display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
            gap: 10px; min-height: 0; flex: 1 1 auto;
        }
        .quicker-api__quick-list {
            display: flex; flex-direction: column; gap: 8px; min-height: 0;
            border: 1px solid var(--qa-border); border-radius: 8px; background: var(--qa-bg);
            padding: 8px; overflow: hidden;
        }
        .quicker-api__quick-list-toolbar { display: flex; gap: 6px; align-items: center; }
        .quicker-api__quick-list-toolbar .menu_button { flex: 1 1 auto; }
        .quicker-api__quick-list-items {
            display: flex; flex-direction: column; gap: 6px; overflow-y: auto; min-height: 0;
            padding-right: 2px;
        }
        .quicker-api__quick-item {
            display: flex; align-items: center; gap: 6px;
            border: 1px solid transparent; border-radius: 6px; padding: 6px 8px;
            cursor: pointer; transition: background 0.12s, border-color 0.12s;
            flex: none; min-width: 0;
        }
        .quicker-api__quick-item:hover { background: var(--qa-bg-hover); }
        .quicker-api__quick-item.is-selected {
            border-color: var(--qa-accent); background: rgba(91, 155, 213, 0.14);
        }
        .quicker-api__quick-item-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
        .quicker-api__quick-select { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .quicker-api__quick-summary { font-size: 11px; color: var(--qa-text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .quicker-api__quick-item-actions { display: flex; align-items: center; gap: 2px; flex: none; }
        .quicker-api__quick-item-actions .menu_button { padding: 2px 6px; font-size: 11px; }
        .quicker-api__quick-editor {
            display: flex; flex-direction: column; gap: 10px; min-height: 0; overflow-y: auto;
            border: 1px solid var(--qa-border); border-radius: 8px; background: var(--qa-bg);
            padding: 12px;
        }
        .quicker-api__quick-editor-title { margin: 0; font-size: 14px; font-weight: 600; }
        .quicker-api__quick-editor-fields { display: flex; flex-direction: column; gap: 10px; }
        .quicker-api__quick-field { display: flex; flex-direction: column; gap: 4px; }
        .quicker-api__quick-field > span { font-size: 12px; color: var(--qa-text-dim); }
        .quicker-api__quick-model-control { display: flex; flex-direction: column; gap: 6px; }
        .quicker-api__quick-editor-actions { display: flex; gap: 6px; justify-content: flex-end; }
        .quicker-api__empty-state {
            font-size: 12px; color: var(--qa-text-dim); line-height: 1.7;
            border: 1px dashed var(--qa-border-strong); border-radius: 6px; padding: 14px;
        }
        .quicker-api__placement-popup {
            display: flex; flex-direction: column; gap: 10px; width: 100%; min-width: 0;
            color: var(--qa-text); font-size: 13px;
        }
        .quicker-api__placement-header {
            display: flex; align-items: center; justify-content: space-between; gap: 8px;
            padding: 8px 10px; border: 1px solid var(--qa-border); border-radius: 8px; background: var(--qa-bg);
        }
        .quicker-api__placement-header strong { font-size: 14px; }
        .quicker-api__placement-actions { display: flex; gap: 6px; }
        .quicker-api__placement-choices { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        .quicker-api__placement-choices .menu_button { justify-content: flex-start; gap: 8px; }
        .quicker-api__placement-choices .menu_button.is-selected {
            border-color: var(--qa-accent); background: rgba(91, 155, 213, 0.16);
        }
        @media (max-width: 720px) {
            .quicker-api__placement-choices { grid-template-columns: 1fr; }
        }
        @media (max-width: 720px) {
            .quicker-api__quick-overlay { inset: 3vh 6px; overflow-y: auto; }
            .quicker-api__quick-manager { padding: 12px; border-radius: 10px; }
            .quicker-api__quick-columns { grid-template-columns: 1fr; flex: none; }
            .quicker-api__quick-list { max-height: 260px; overflow: hidden; }
            .quicker-api__quick-list-items {
                flex-direction: column; overflow-y: auto; overflow-x: hidden;
                padding-bottom: 4px;
            }
            .quicker-api__quick-item { width: 100%; min-width: 0; }
            .quicker-api__quick-item-actions .menu_button { padding: 2px 5px; }
        }
    `).appendTo(document.head);
}

export async function chooseQuickActionPlacement(current: QuickActionPlacement, onConfirm: (placement: QuickActionPlacement) => void): Promise<void> {
    if (runtimeState.quickActionPlacementPopup) await runtimeState.quickActionPlacementPopup.completeCancelled();
    let selected = normalizeQuickActionPlacement(current);
    const content = $('<div class="quicker-api__placement-popup">');
    const confirm = $('<button type="button" class="menu_button quicker-api__save-button" title="应用" aria-label="应用入口位置"><i class="fa-solid fa-check"></i></button>');
    const cancel = $('<button type="button" class="menu_button" title="取消" aria-label="取消入口位置更改"><i class="fa-solid fa-xmark"></i></button>');
    const header = $('<div class="quicker-api__placement-header">').append(
        $('<strong>').text('便捷入口位置'),
        $('<div class="quicker-api__placement-actions">').append(confirm, cancel),
    );
    const choices = $('<div class="quicker-api__placement-choices">').append(
        $('<button type="button" class="menu_button" data-placement="leftSendForm"><i class="fa-solid fa-arrow-left"></i><span>发送栏左侧</span></button>'),
        $('<button type="button" class="menu_button" data-placement="rightSendForm"><i class="fa-solid fa-arrow-right"></i><span>发送栏右侧</span></button>'),
        $('<button type="button" class="menu_button" data-placement="qrButtons"><i class="fa-solid fa-table-cells-large"></i><span>Quick Reply 按钮栏</span></button>'),
        $('<button type="button" class="menu_button" data-placement="disabled"><i class="fa-solid fa-ban"></i><span>不使用便捷按钮</span></button>'),
    );
    const renderSelection = () => choices.find('[data-placement]').each((_, button) => {
        $(button).toggleClass('is-selected', String($(button).data('placement')) === selected);
    });
    content.append(header, choices);
    renderSelection();
    const popup = new Popup(content, POPUP_TYPE.DISPLAY, '', { animation: 'none', wider: true, leftAlign: true });
    runtimeState.quickActionPlacementPopup = popup;
    ownedPopups.add(popup);
    choices.on('click', '[data-placement]', function () {
        selected = normalizeQuickActionPlacement(String($(this).data('placement')));
        renderSelection();
    });
    confirm.on('click', async () => {
        onConfirm(selected);
        await popup.completeAffirmative();
    });
    cancel.on('click', () => void popup.completeCancelled());
    try {
        await popup.show();
    } finally {
        ownedPopups.delete(popup);
        if (runtimeState.quickActionPlacementPopup === popup) runtimeState.quickActionPlacementPopup = null;
    }
}

function createQuickManagerDraft() {
    const globalDraft = settings().quickActions.map(action => normalizeQuickAction(structuredClone(action)));
    return { globalDraft };
}

export function manageQuickActions(): void {
    if (runtimeState.extensionDisabled || runtimeState.teardownPending) return;
    ensureQuickManagerStyles();
    const { globalDraft } = createQuickManagerDraft();
    let draftPlacement = normalizeQuickActionPlacement(settings().quickActionPlacement);
    let selectedId = globalDraft[0]?.id || '';
    let detailDraft: QuickAction | null = globalDraft[0] || null;

    const overlay = $('<div class="quicker-api__quick-overlay"></div>').appendTo(document.body);
    const content = $('<div class="quicker-api__quick-manager"></div>');
    overlay.append(content);
    const header = $('<header class="quicker-api__quick-header">');
    const title = $('<div class="quicker-api__quick-title"><i class="fa-solid fa-bolt"></i><span>便捷按钮管理</span></div>');
    const placementButton = $('<button type="button" class="menu_button" title="入口位置" aria-label="设置便捷入口位置"><i class="fa-solid fa-gear"></i><span>位置设置</span></button>');
    const close = $('<button type="button" class="menu_button" title="离开" aria-label="离开便捷按钮管理"><i class="fa-solid fa-xmark"></i></button>');
    header.append(title.append(placementButton), $('<div class="quicker-api__quick-header-actions">').append(close));
    const add = $('<button class="menu_button" type="button"><i class="fa-solid fa-plus"></i><span>新增方案</span></button>');
    const list = $('<div class="quicker-api__quick-list">');
    const listItems = $('<div class="quicker-api__quick-list-items" role="listbox" aria-label="便捷方案">');
    list.append($('<div class="quicker-api__quick-list-toolbar">').append(add), listItems);
    const editor = $('<div class="quicker-api__quick-editor">');
    content.append(header, $('<div class="quicker-api__quick-columns">').append(list, editor));

    const persistQuickActions = () => {
        const normalized = normalizeQuickActionsForPersist(globalDraft);
        globalDraft.forEach((action, index) => Object.assign(action, normalized[index]));
        settings().quickActions = globalDraft;
        saveSettingsDebounced();
        ensureQuickActionEntries();
    };

    const closeManager = () => {
        overlay.remove();
    };
    let managerOpen = true;
    const selectAction = (id: string, force = false) => {
        if (!force && id === selectedId) return;
        selectedId = id;
        detailDraft = globalDraft.find(item => item.id === selectedId) || null;
        render();
    };
    const field = (label: string, control: JQuery<HTMLElement>) => $('<label class="quicker-api__quick-field">').append($('<span>').text(label), control);
    const renderEditor = () => {
        editor.empty();
        if (!detailDraft) {
            editor.append($('<div class="quicker-api__empty-state">').text('从左侧选择一个方案进行编辑，或点击"新增方案"创建。方案可以切换 preset、逻辑模型或真实模型；留空字段表示不执行对应动作。'));
            return;
        }
        const draft = detailDraft;
        const name = $('<input class="text_pole" type="text" maxlength="120" placeholder="留空自动命名为方案N">').val(draft.name);
        const preset = $(`<select class="text_pole">${presetOptionsHtml(draft.preset)}</select>`);
        const modelSelect = $('<select class="text_pole quicker-api__quick-model-select"></select>');
        const refreshModels = () => {
            // 聚合模型（供应商路由）与逻辑模型合并候选；select2 提供 ST 原生搜索下拉
            const logicalNames = logicalModels().map(model => model.name);
            const models = normalizeModelList([...aggregateModels(providers()), ...logicalNames, draft.model])
                .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
            modelSelect.empty().append($('<option value="">— 不切换模型 —</option>'));
            models.forEach(model => modelSelect.append($('<option>').val(model).text(model)));
            modelSelect.val(draft.model && models.includes(draft.model) ? draft.model : '');
        };
        refreshModels();
        modelSelect.on('change', () => {
            draft.model = normalizeText(modelSelect.val()).slice(0, 500);
            persistQuickActions();
        });
        const modelControl = $('<div class="quicker-api__quick-model-control"></div>').append(modelSelect);
        name.on('input', () => {
            draft.name = sanitizeName(name.val());
            persistQuickActions();
        });
        preset.on('change', () => {
            draft.preset = normalizeText(preset.val());
            persistQuickActions();
        });
        editor.append(
            $('<h4 class="quicker-api__quick-editor-title">').text('方案详情'),
            $('<div class="quicker-api__quick-editor-fields">').append(
                field('名称', name), field('预设', preset), field('模型', modelControl),
            ),
        );
    };
    const render = () => {
        listItems.empty();
        globalDraft.forEach((action, index) => {
            const row = $('<div class="quicker-api__quick-item" role="option" tabindex="0">')
                .toggleClass('is-selected', action.id === selectedId)
                .attr('aria-selected', action.id === selectedId ? 'true' : 'false');
            const info = $('<div class="quicker-api__quick-item-info"></div>');
            info.append($('<span class="quicker-api__quick-select">').text(quickActionDisplayName(action, index)).attr('title', quickActionDisplayName(action, index)));
            const summaryParts: string[] = [];
            if (action.preset) summaryParts.push(`预设：${action.preset}`);
            if (action.model) summaryParts.push(`模型：${action.model}`);
            info.append($('<span class="quicker-api__quick-summary">').text(summaryParts.join(' · ') || '未配置'));
            const actions = $('<div class="quicker-api__quick-item-actions"></div>');
            const makeRowButton = (label: string, icon: string, disabled: boolean, handler: () => void, danger = false) => $('<button type="button" class="menu_button">')
                .toggleClass('quicker-api__delete-button', danger).attr({ title: label, 'aria-label': label }).prop('disabled', disabled)
                .append($(`<i class="fa-solid ${icon}"></i>`)).on('click', event => { event.stopPropagation(); handler(); });
            const up = makeRowButton('上移', 'fa-arrow-up', index === 0, () => {
                [globalDraft[index - 1], globalDraft[index]] = [globalDraft[index], globalDraft[index - 1]]; persistQuickActions(); render();
            });
            const down = makeRowButton('下移', 'fa-arrow-down', index === globalDraft.length - 1, () => {
                [globalDraft[index + 1], globalDraft[index]] = [globalDraft[index], globalDraft[index + 1]]; persistQuickActions(); render();
            });
            const copy = makeRowButton('复制', 'fa-clone', false, () => {
                const clone = normalizeQuickAction({ ...structuredClone(action), id: makeId('quick-action'), name: `${quickActionDisplayName(action, index)} 副本` }, index + 1);
                globalDraft.splice(index + 1, 0, clone); persistQuickActions(); selectAction(clone.id);
            });
            const remove = makeRowButton('删除', 'fa-trash', false, () => {
                globalDraft.splice(index, 1); persistQuickActions();
                selectAction(globalDraft[Math.min(index, globalDraft.length - 1)]?.id || '');
            }, true);
            actions.append(up, down, copy, remove);
            row.append(info, actions).on('click', () => selectAction(action.id)).on('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectAction(action.id); }
            });
            listItems.append(row);
        });
        renderEditor();
        const modelSelectEl = editor.find('.quicker-api__quick-model-select');
        if (modelSelectEl.length) {
            modelSelectEl.select2({
                placeholder: '选择或搜索模型…',
                searchInputPlaceholder: '搜索模型…',
                searchInputCssClass: 'text_pole',
                width: '100%',
                dropdownParent: content[0],
                matcher: function (params: any, data: any) {
                    if (!params.term || params.term.trim() === '') return data;
                    const term = String(params.term).toLowerCase();
                    const text = String(data.text || '').toLowerCase();
                    return text.includes(term) ? data : null;
                },
            });
        }
    };
    add.on('click', () => {
        const action = normalizeQuickAction({ id: makeId('quick-action'), sequence: globalDraft.length });
        globalDraft.push(action);
        persistQuickActions();
        selectAction(action.id);
    });
    placementButton.on('click', () => void chooseQuickActionPlacement(draftPlacement, value => {
        draftPlacement = value;
        settings().quickActionPlacement = value;
        saveSettingsDebounced();
        ensureQuickActionEntries();
        toastr.success('便捷入口位置已应用。');
    }));
    close.on('click', closeManager);
    render();
    // 自动保存：所有改动在编辑时已通过 persistQuickActions 写入，关闭无需再写
    // 浮层挂到 body 后一直显示；通过 close 按钮移除。点击浮层空白处也可关闭（不误触卡片内部）
    overlay.on('mousedown', event => {
        if (event.target === overlay[0]) closeManager();
    });
    managerOpen = false;
}
