// 便捷方案下拉选项 HTML

import { profiles } from '../settings/access.js';
import { FORMATS } from '../constants.js';
import { normalizeText, escapeHtml } from '../utils/text.js';
import { normalizeModelList } from '../utils/model-list.js';

export function presetOptionsHtml(selected = ''): string {
    const names = $('#settings_preset_openai option').map((_, option) => normalizeText(option.textContent)).get().filter(Boolean);
    const missing = selected && !names.includes(selected)
        ? [`<option value="${escapeHtml(selected)}" selected>⚠ 已不存在：${escapeHtml(selected)}</option>`]
        : [];
    return ['<option value="">— 不切换 preset —</option>', ...missing, ...names.map(name =>
        `<option value="${escapeHtml(name)}"${name === selected ? ' selected' : ''}>${escapeHtml(name)}</option>`,
    )].join('');
}

export function profileOptionsHtml(selected = ''): string {
    const exists = profiles().some(profile => profile.id === selected);
    const missing = selected && !exists
        ? [`<option value="${escapeHtml(selected)}" selected>⚠ Profile 已不存在</option>`]
        : [];
    return ['<option value="">— 不切换 Profile —</option>', ...missing, ...profiles().map(profile =>
        `<option value="${escapeHtml(profile.id)}"${profile.id === selected ? ' selected' : ''}>${escapeHtml(profile.name)}</option>`,
    )].join('');
}

export function modelSuggestionsForProfile(profileId = ''): string[] {
    const profile = profiles().find(item => item.id === profileId) || null;
    if (!profile) return [];
    if (profile.format === 'openai') return normalizeModelList([profile.model, ...(profile.availableModels || [])]);
    const native = $(FORMATS[profile.format].modelInput).find('option').map((_, option) => String(option.value || '')).get();
    return normalizeModelList([profile.model, ...native]);
}
