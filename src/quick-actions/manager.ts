// 便捷方案管理界面（拆解自 manageQuickActions：draft / list / editor / commit）

import { saveSettingsDebounced } from '@sillytavern/script';
import { Popup, POPUP_TYPE } from '@sillytavern/scripts/popup';
import { runtimeState, ownedPopups } from '../state.js';
import { settings, profiles, providers, logicalModels } from '../settings/access.js';
import { normalizeQuickAction, normalizeQuickActionPlacement, quickActionDisplayName } from '../domain/quick-action.js';
import { aggregateModels } from '../domain/model-catalog.js';
import { normalizeText, sanitizeName } from '../utils/text.js';
import { normalizeModelList } from '../utils/model-list.js';
import { makeId } from '../utils/id.js';
import { presetOptionsHtml, profileOptionsHtml, modelSuggestionsForProfile } from './options.js';
import { ensureQuickActionEntries } from './menu.js';
import { fetchModelsForProfile } from '../models/fetch.js';
import { enqueueOperation } from '../operation-queue.js';
import type { QuickAction, QuickActionPlacement } from '../types.js';

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
    const popup = new Popup(content, POPUP_TYPE.DISPLAY, '', { animation: 'none' });
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
    return {
        globalDraft,
        initialGlobalSnapshot: JSON.stringify(globalDraft),
    };
}

export async function manageQuickActions(): Promise<void> {
    if (runtimeState.extensionDisabled || runtimeState.teardownPending) return;
    const { globalDraft, initialGlobalSnapshot } = createQuickManagerDraft();
    let draftPlacement = normalizeQuickActionPlacement(settings().quickActionPlacement);
    let selectedId = globalDraft[0]?.id || '';
    let detailDraft = selectedId ? structuredClone(globalDraft[0]) : null;
    let detailBaseline = detailDraft ? JSON.stringify(detailDraft) : '';
    let detailCandidates = detailDraft ? modelSuggestionsForProfile(detailDraft.profileId) : [];

    const content = $('<div class="quicker-api__quick-manager">');
    const header = $('<header class="quicker-api__quick-header">');
    const title = $('<div class="quicker-api__quick-title"><i class="fa-solid fa-bolt"></i><span>便捷按钮管理</span></div>');
    const placementButton = $('<button type="button" class="menu_button" title="入口位置" aria-label="设置便捷入口位置"><i class="fa-solid fa-gear"></i><span>位置设置</span></button>');
    const saveAll = $('<button type="button" class="menu_button quicker-api__save-button"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></button>');
    const close = $('<button type="button" class="menu_button" title="关闭并丢弃更改" aria-label="关闭并丢弃更改"><i class="fa-solid fa-xmark"></i></button>');
    header.append(title.append(placementButton), $('<div class="quicker-api__quick-header-actions">').append(saveAll, close));
    const add = $('<button class="menu_button" type="button"><i class="fa-solid fa-plus"></i><span>新增方案</span></button>');
    const list = $('<div class="quicker-api__quick-list">');
    const listItems = $('<div class="quicker-api__quick-list-items" role="listbox" aria-label="便捷方案">');
    list.append($('<div class="quicker-api__quick-list-toolbar">').append(add), listItems);
    const editor = $('<div class="quicker-api__quick-editor">');
    content.append(header, $('<div class="quicker-api__quick-columns">').append(list, editor));

    const popup = new Popup(content, POPUP_TYPE.DISPLAY, '', { animation: 'none' });
    let managerOpen = true;
    ownedPopups.add(popup);
    const selectAction = (id: string, force = false) => {
        if (!force && id === selectedId) return;
        selectedId = id;
        const action = globalDraft.find(item => item.id === selectedId) || null;
        detailDraft = action ? structuredClone(action) : null;
        detailBaseline = detailDraft ? JSON.stringify(detailDraft) : '';
        detailCandidates = detailDraft ? modelSuggestionsForProfile(detailDraft.profileId) : [];
        render();
    };
    const field = (label: string, control: JQuery<HTMLElement>) => $('<label class="quicker-api__quick-field">').append($('<span>').text(label), control);
    const updateDetailSaveState = () => editor.toggleClass('has-unsaved-detail', Boolean(detailDraft) && JSON.stringify(detailDraft) !== detailBaseline);
    const renderEditor = () => {
        editor.empty().removeClass('has-unsaved-detail');
        if (!detailDraft) {
            editor.append($('<div class="quicker-api__empty-state">').text('新增方案后，可组合 preset、Profile 与模型。模型填逻辑模型名时，点击按钮只切换当前分组的模型（不立即改连接）；填真实模型名时按原有逻辑写入。'));
            return;
        }
        const draft = detailDraft;
        const name = $('<input class="text_pole" type="text" maxlength="120" placeholder="留空自动命名为方案N">').val(draft.name);
        const preset = $(`<select class="text_pole">${presetOptionsHtml(draft.preset)}</select>`);
        const profileSelect = $(`<select class="text_pole">${profileOptionsHtml(draft.profileId)}</select>`);
        const modelInput = $('<input class="text_pole" type="text" maxlength="500" placeholder="模型名：逻辑模型（点击只切换分组模型）或真实模型名">').val(draft.model);
        const modelSelect = $('<select class="text_pole" aria-label="从配置模型列表选择"></select>');
        const refreshModels = () => {
            // 聚合模型（供应商路由）优先入候选：快捷方案选模型即参与路由；逻辑模型名同样入候选
            const logicalNames = logicalModels().map(model => model.name);
            const models = normalizeModelList([...aggregateModels(providers()), ...logicalNames, ...modelSuggestionsForProfile(draft.profileId), ...detailCandidates, draft.model]);
            modelSelect.empty().append($('<option value="">— 从模型列表选择 —</option>'));
            models.forEach(model => modelSelect.append($('<option>').val(model).text(model)));
            modelSelect.val(models.includes(draft.model) ? draft.model : '');
        };
        refreshModels();
        const fetchModels = $('<button type="button" class="menu_button" title="拉取所选 Profile 的模型"><i class="fa-solid fa-arrows-rotate"></i><span>拉取模型</span></button>');
        const modelControl = $('<div class="quicker-api__quick-model-control">').append(modelInput, modelSelect, fetchModels);
        const selectedProfileValue = () => profiles().find(item => item.id === draft.profileId) || null;
        fetchModels.prop('disabled', selectedProfileValue()?.format !== 'openai');
        name.on('input', () => { draft.name = sanitizeName(name.val()); updateDetailSaveState(); });
        preset.on('change', () => { draft.preset = normalizeText(preset.val()); updateDetailSaveState(); });
        profileSelect.on('change', () => {
            draft.profileId = normalizeText(profileSelect.val());
            detailCandidates = modelSuggestionsForProfile(draft.profileId);
            renderEditor();
        });
        modelSelect.on('change', () => {
            const selectedModel = normalizeText(modelSelect.val()).slice(0, 500);
            if (!selectedModel) return;
            draft.model = selectedModel;
            modelInput.val(selectedModel);
            updateDetailSaveState();
        });
        modelInput.on('input', () => {
            draft.model = normalizeText(modelInput.val()).slice(0, 500);
            const exists = modelSelect.find('option').filter((_, option) => (option as HTMLOptionElement).value === draft.model).length;
            modelSelect.val(exists ? draft.model : '');
            updateDetailSaveState();
        });
        fetchModels.on('click', async () => {
            const profile = selectedProfileValue();
            if (!profile || profile.format !== 'openai') return toastr.info('请选择 OpenAI Compatible Profile 后拉取模型。');
            const endpoint = normalizeText(profile.endpoint);
            if (!endpoint) return toastr.warning('所选 Profile 没有可用的 Custom URL。');
            fetchModels.prop('disabled', true);
            let fetchError: unknown = null;
            const result = await enqueueOperation(async () => {
                try {
                    return await fetchModelsForProfile(structuredClone(profile), endpoint);
                } catch (error) {
                    fetchError = error;
                    return null;
                }
            });
            if (!managerOpen || runtimeState.extensionDisabled || runtimeState.teardownPending) return;
            if (!result) {
                if (fetchError) console.error('[QuickerApi] Quick action model fetch failed:', fetchError);
                if (fetchError) toastr.error('前端 /models 与后端 status 均获取失败。');
                if (detailDraft) renderEditor();
                return;
            }
            if (detailDraft?.profileId !== profile.id) return;
            detailCandidates = normalizeModelList([...detailCandidates, ...result.models]);
            toastr.success(`通过${result.route}获取 ${result.models.length} 个模型；结果仅用于当前方案草稿。`);
            renderEditor();
        });
        const saveScheme = $('<button type="button" class="menu_button quicker-api__save-button"><i class="fa-solid fa-floppy-disk"></i><span>保存方案</span></button>');
        const cancelScheme = $('<button type="button" class="menu_button"><span>取消</span></button>');
        saveScheme.on('click', () => {
            if (!draft.preset && !draft.profileId && !draft.model) return toastr.warning('方案至少需要 preset、Profile 或 model 中的一项。');
            const index = globalDraft.findIndex(item => item.id === selectedId);
            if (index < 0) return;
            globalDraft[index] = normalizeQuickAction(structuredClone(draft), index);
            detailDraft = structuredClone(globalDraft[index]);
            detailBaseline = JSON.stringify(detailDraft);
            render();
            toastr.success('方案修改已保存；点击顶部"保存"后写入设置。');
        });
        cancelScheme.on('click', () => selectAction(selectedId, true));
        editor.append(
            $('<h4 class="quicker-api__quick-editor-title">').text('方案详情'),
            $('<div class="quicker-api__quick-editor-fields">').append(
                field('名称', name), field('预设', preset), field('配置', profileSelect), field('模型', modelControl),
            ),
            $('<div class="quicker-api__quick-editor-actions">').append(saveScheme, cancelScheme),
        );
        updateDetailSaveState();
    };
    const updateSaveState = () => saveAll.toggleClass('is-dirty', JSON.stringify(globalDraft) !== initialGlobalSnapshot);
    const render = () => {
        listItems.empty();
        globalDraft.forEach((action, index) => {
            const row = $('<div class="quicker-api__quick-item" role="option" tabindex="0">')
                .toggleClass('is-selected', action.id === selectedId)
                .attr('aria-selected', action.id === selectedId ? 'true' : 'false');
            const name = $('<span class="quicker-api__quick-select">').text(quickActionDisplayName(action, index)).attr('title', quickActionDisplayName(action, index));
            const makeRowButton = (label: string, icon: string, disabled: boolean, handler: () => void, danger = false) => $('<button type="button" class="menu_button">')
                .toggleClass('quicker-api__delete-button', danger).attr({ title: label, 'aria-label': label }).prop('disabled', disabled)
                .append($(`<i class="fa-solid ${icon}"></i>`)).on('click', event => { event.stopPropagation(); handler(); });
            const up = makeRowButton('上移', 'fa-arrow-up', index === 0, () => {
                [globalDraft[index - 1], globalDraft[index]] = [globalDraft[index], globalDraft[index - 1]]; render();
            });
            const down = makeRowButton('下移', 'fa-arrow-down', index === globalDraft.length - 1, () => {
                [globalDraft[index + 1], globalDraft[index]] = [globalDraft[index], globalDraft[index + 1]]; render();
            });
            const copy = makeRowButton('复制', 'fa-clone', false, () => {
                const clone = normalizeQuickAction({ ...structuredClone(action), id: makeId('quick-action'), name: `${quickActionDisplayName(action, index)} 副本` }, index + 1);
                globalDraft.splice(index + 1, 0, clone); selectAction(clone.id);
            });
            const remove = makeRowButton('删除', 'fa-trash', false, () => {
                globalDraft.splice(index, 1);
                selectAction(globalDraft[Math.min(index, globalDraft.length - 1)]?.id || '');
            }, true);
            row.append(name, up, down, copy, remove).on('click', () => selectAction(action.id)).on('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectAction(action.id); }
            });
            listItems.append(row);
        });
        renderEditor();
        updateSaveState();
    };
    add.on('click', () => {
        const action = normalizeQuickAction({ id: makeId('quick-action'), sequence: globalDraft.length });
        globalDraft.push(action);
        selectAction(action.id);
    });
    placementButton.on('click', () => void chooseQuickActionPlacement(draftPlacement, value => {
        draftPlacement = value;
        settings().quickActionPlacement = value;
        saveSettingsDebounced();
        ensureQuickActionEntries();
        toastr.success('便捷入口位置已应用。');
    }));
    close.on('click', () => void popup.completeCancelled());
    saveAll.on('click', () => {
        const invalid = globalDraft.find(action => !action.preset && !action.profileId && !action.model);
        if (invalid) return toastr.warning('请先在右侧保存每个方案；每项至少需要 preset、Profile 或 model。');
        const validProfileIds = new Set(profiles().map(profile => profile.id));
        if (globalDraft.some(action => action.profileId && !validProfileIds.has(action.profileId))) return toastr.warning('方案引用了已不存在的 Profile，请重新选择并保存方案。');
        const validPresetNames = new Set($('#settings_preset_openai option').map((_, option) => normalizeText(option.textContent)).get());
        if (globalDraft.some(action => action.preset && !validPresetNames.has(action.preset))) return toastr.warning('方案引用了已不存在的 preset，请重新选择并保存方案。');
        globalDraft.forEach((action, index) => {
            action.name = sanitizeName(action.name) || `方案${index + 1}`;
            action.sequence = index;
        });
        void popup.completeAffirmative();
    });
    render();
    let result: string | null = null;
    try {
        result = await popup.show();
    } finally {
        managerOpen = false;
        ownedPopups.delete(popup);
    }
    if (!result || runtimeState.extensionDisabled || runtimeState.teardownPending) return;
    settings().quickActions = globalDraft;
    settings().quickActionPlacement = draftPlacement;
    saveSettingsDebounced();
    ensureQuickActionEntries();
}
