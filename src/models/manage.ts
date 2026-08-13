// 模型列表管理（拆解自 manageCustomModels：draft / remote / chosen / actions / commit）

import { saveSettingsDebounced } from '@sillytavern/script';
import { POPUP_TYPE } from '@sillytavern/scripts/popup';
import { selectedProfile } from '../settings/access.js';
import { normalizeModelList } from '../utils/model-list.js';
import { normalizeText } from '../utils/text.js';
import { callQuickerPopup } from '../popups.js';
import { getEditorModel, syncEditorModelToNative } from '../native/fields.js';
import { fetchModelsForProfile } from './fetch.js';
import { renderModelControl, renderStatus } from '../ui/render.js';
import type { ModelFetchResult, Profile } from '../types.js';

export interface ModelManagerDraft {
    current: string;
    available: string[];
    fetched: string[];
    fetchedFromEndpoint: string;
    customized: boolean;
}

export function createManagerDraft(profile: Profile, endpoint: string): ModelManagerDraft {
    const draft: ModelManagerDraft = {
        current: normalizeText(getEditorModel('openai') || profile.model),
        available: normalizeModelList(profile.availableModels),
        fetched: profile.fetchedFromEndpoint === endpoint ? normalizeModelList(profile.fetchedModels) : [],
        fetchedFromEndpoint: profile.fetchedFromEndpoint === endpoint ? endpoint : '',
        customized: Boolean(profile.customized),
    };
    if (draft.current && !draft.available.includes(draft.current)) draft.available.unshift(draft.current);
    return draft;
}

export function ensureCurrentInDraft(draft: ModelManagerDraft): void {
    draft.available = normalizeModelList(draft.available);
    if (draft.current && !draft.available.includes(draft.current)) draft.available.unshift(draft.current);
}

export function markDraftCustomized(draft: ModelManagerDraft): void {
    draft.customized = true;
    ensureCurrentInDraft(draft);
}

function renderRemoteList(draft: ModelManagerDraft, remoteList: JQuery<HTMLElement>, renderManager: () => void): void {
    const selected = new Set(draft.available);
    remoteList.empty();
    if (!draft.fetched.length) remoteList.append($('<div class="quicker-api__empty-state">').text('尚无当前 URL 的远端快照'));
    for (const model of draft.fetched) {
        const checkbox = $('<input type="checkbox">').prop('checked', selected.has(model)).attr('aria-label', `选择 ${model}`);
        const row = $('<div class="quicker-api__model-item quicker-api__remote-model" role="checkbox" tabindex="0">')
            .attr('aria-checked', selected.has(model) ? 'true' : 'false').append(checkbox, $('<span>').text(model), $('<small>').text('远端'));
        const toggle = (checked: boolean) => {
            if (checked) draft.available = normalizeModelList([...draft.available, model]);
            else if (model !== draft.current) draft.available = draft.available.filter(item => item !== model);
            markDraftCustomized(draft);
            renderManager();
        };
        checkbox.on('click', event => event.stopPropagation()).on('change', () => toggle(checkbox.prop('checked')));
        row.on('click', () => toggle(!selected.has(model))).on('keydown', event => {
            if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                toggle(!selected.has(model));
            }
        });
        remoteList.append(row);
    }
}

function renderChosenList(draft: ModelManagerDraft, chosenList: JQuery<HTMLElement>, remoteSet: Set<string>, renderManager: () => void): void {
    chosenList.empty();
    if (!draft.available.length) chosenList.append($('<div class="quicker-api__empty-state">').text('留存列表为空'));
    draft.available.forEach((model, index) => {
        const input = $('<input class="text_pole" type="text" readonly>').val(model).attr('aria-label', `模型 ${model}`);
        const edit = $('<button type="button" class="menu_button" title="编辑" aria-label="编辑"><i class="fa-solid fa-pen"></i></button>');
        const remove = $('<button type="button" class="menu_button" title="删除" aria-label="删除"><i class="fa-solid fa-trash"></i></button>');
        const up = $('<button type="button" class="menu_button" title="上移" aria-label="上移"><i class="fa-solid fa-arrow-up"></i></button>').prop('disabled', index === 0);
        const down = $('<button type="button" class="menu_button" title="下移" aria-label="下移"><i class="fa-solid fa-arrow-down"></i></button>').prop('disabled', index === draft.available.length - 1);
        const commitEdit = () => {
            const next = normalizeText(input.val());
            if (!next || (next !== model && draft.available.includes(next))) return renderManager();
            draft.available[index] = next;
            if (draft.current === model) draft.current = next;
            markDraftCustomized(draft);
            renderManager();
        };
        edit.on('click', () => input.prop('readonly', false).trigger('focus').trigger('select'));
        input.on('keydown', event => {
            if (event.key === 'Enter') commitEdit();
            if (event.key === 'Escape') renderManager();
        }).on('change', commitEdit);
        remove.on('click', () => {
            const deletingCurrent = draft.current === model;
            draft.available.splice(index, 1);
            if (deletingCurrent) draft.current = draft.available[0] || '';
            markDraftCustomized(draft);
            renderManager();
        });
        up.on('click', () => {
            [draft.available[index - 1], draft.available[index]] = [draft.available[index], draft.available[index - 1]];
            markDraftCustomized(draft);
            renderManager();
        });
        down.on('click', () => {
            [draft.available[index + 1], draft.available[index]] = [draft.available[index], draft.available[index + 1]];
            markDraftCustomized(draft);
            renderManager();
        });
        const source = remoteSet.has(model) ? '远端' : '自定义';
        chosenList.append($('<div class="quicker-api__model-item quicker-api__chosen-model">').append(
            $('<span class="quicker-api__drag-index">').text(index + 1), input, $('<small>').text(source),
            $('<div class="quicker-api__item-actions">').append(edit, remove, up, down),
        ));
    });
}

function applyRemoteAction(action: string, draft: ModelManagerDraft): void {
    if (action === 'all') draft.available = normalizeModelList([...draft.available, ...draft.fetched]);
    if (action === 'invert') {
        const remote = new Set(draft.fetched);
        draft.available = normalizeModelList([
            ...draft.available.filter(model => !remote.has(model) || !draft.fetched.includes(model)),
            ...draft.fetched.filter(model => !draft.available.includes(model)),
        ]);
    }
    if (action === 'none') draft.available = draft.available.filter(model => !draft.fetched.includes(model) || model === draft.current);
}

function buildManagerPopup(profile: Profile, endpoint: string, draft: ModelManagerDraft, initialDraft: ModelManagerDraft) {
    const content = $('<div class="quicker-api__model-manager">');
    content.append($('<div class="quicker-api__manager-note">').text('所有修改仅在确认后保存，取消会完整回滚。'));
    const columns = $('<div class="quicker-api__manager-columns">');
    const remotePanel = $('<section class="quicker-api__manager-panel">');
    const chosenPanel = $('<section class="quicker-api__manager-panel">');
    const remoteActions = $('<div class="quicker-api__manager-actions">').append(
        $('<button type="button" class="menu_button" data-action="fetch"><i class="fa-solid fa-arrows-rotate"></i><span>获取</span></button>'),
        $('<button type="button" class="menu_button" data-action="all">全选</button>'),
        $('<button type="button" class="menu_button" data-action="invert">反选</button>'),
        $('<button type="button" class="menu_button" data-action="none">全不选</button>'),
    );
    const customInput = $('<input class="text_pole" type="text" autocomplete="off" placeholder="自定义模型 ID">');
    const chosenActions = $('<div class="quicker-api__manager-actions">').append(
        customInput,
        $('<button type="button" class="menu_button" data-action="add"><i class="fa-solid fa-plus"></i><span>新增</span></button>'),
        $('<button type="button" class="menu_button" data-action="clear">清空</button>'),
        $('<button type="button" class="menu_button" data-action="reset">重置</button>'),
    );
    const remoteList = $('<div class="quicker-api__model-list">');
    const chosenList = $('<div class="quicker-api__model-list">');
    remotePanel.append($('<h4><i class="fa-solid fa-cloud-arrow-down"></i> 远端模型</h4>'), remoteActions, remoteList);
    chosenPanel.append($('<h4><i class="fa-solid fa-list-check"></i> 下拉留存 / 自定义</h4>'), chosenActions, chosenList);
    columns.append(remotePanel, chosenPanel);
    content.append(columns);

    const renderManager = () => {
        ensureCurrentInDraft(draft);
        const remoteSet = new Set(draft.fetched);
        renderRemoteList(draft, remoteList, renderManager);
        renderChosenList(draft, chosenList, remoteSet, renderManager);
    };

    remoteActions.on('click', 'button', async function () {
        const action = String($(this).data('action'));
        if (action === 'fetch') {
            const button = $(this).prop('disabled', true);
            try {
                const result: ModelFetchResult = await fetchModelsForProfile(profile, endpoint);
                draft.fetched = result.models;
                draft.fetchedFromEndpoint = endpoint;
                if (!draft.customized) draft.available = normalizeModelList([draft.current, ...result.models]);
                toastr.success(`通过${result.route}获取 ${result.models.length} 个模型；确认后保存快照。`);
            } catch (error) {
                console.error('[QuickerApi] Model manager fetch failed:', error);
                toastr.error('前端 /models 与后端 status 均获取失败。');
            } finally {
                button.prop('disabled', false);
                renderManager();
            }
            return;
        }
        applyRemoteAction(action, draft);
        markDraftCustomized(draft);
        renderManager();
    });
    const addDraftModel = () => {
        const model = normalizeText(customInput.val());
        if (!model) return;
        draft.available = normalizeModelList([...draft.available, model]);
        customInput.val('');
        markDraftCustomized(draft);
        renderManager();
    };
    chosenActions.on('click', 'button', function () {
        const action = String($(this).data('action'));
        if (action === 'add') addDraftModel();
        if (action === 'clear') {
            draft.available = [];
            draft.current = '';
            markDraftCustomized(draft);
            renderManager();
        }
        if (action === 'reset') {
            Object.assign(draft, structuredClone(initialDraft));
            renderManager();
        }
    });
    customInput.on('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addDraftModel();
        }
    });
    renderManager();
    return { content, renderManager };
}

export function commitManagerDraft(profile: Profile, draft: ModelManagerDraft): void {
    ensureCurrentInDraft(draft);
    profile.availableModels = draft.available;
    profile.fetchedModels = draft.fetched;
    profile.customized = draft.customized;
    profile.fetchedFromEndpoint = draft.fetchedFromEndpoint;
    profile.updatedAt = new Date().toISOString();
    saveSettingsDebounced();
    renderModelControl(profile);
    $('#quicker_api_custom_model').val(draft.current);
    syncEditorModelToNative();
    renderStatus();
}

export async function manageCustomModels(): Promise<void> {
    const profile = selectedProfile();
    if (!profile || profile.format !== 'openai') { toastr.info('请先选择并保存 OpenAI Compatible 配置。'); return; }
    if (normalizeText($('#quicker_api_key_input').val())) { toastr.info('Key 尚未保存，请先点击保存按钮再管理或获取模型。'); return; }
    const endpoint = normalizeText($('#quicker_api_url').val());
    if (endpoint !== normalizeText(profile.endpoint)) { toastr.info('URL 已变化，请先保存配置再管理模型。'); return; }

    const draft = createManagerDraft(profile, endpoint);
    const initialDraft = structuredClone(draft);
    const { content } = buildManagerPopup(profile, endpoint, draft, initialDraft);

    if (!await callQuickerPopup(content, POPUP_TYPE.CONFIRM, '', {
        wide: true,
        large: true,
        okButton: '保存',
        cancelButton: '取消',
        animation: 'none',
    })) return;
    commitManagerDraft(profile, draft);
}
