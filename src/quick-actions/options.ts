// 便捷方案下拉选项 HTML

import { FORMATS } from '../constants.js';
import { normalizeText, escapeHtml } from '../utils/text.js';

export function presetOptionsHtml(selected = ''): string {
    const names = $('#settings_preset_openai option').map((_, option) => normalizeText(option.textContent)).get().filter(Boolean);
    const missing = selected && !names.includes(selected)
        ? [`<option value="${escapeHtml(selected)}" selected>⚠ 已不存在：${escapeHtml(selected)}</option>`]
        : [];
    return ['<option value="">— 不切换 preset —</option>', ...missing, ...names.map(name =>
        `<option value="${escapeHtml(name)}"${name === selected ? ' selected' : ''}>${escapeHtml(name)}</option>`,
    )].join('');
}
