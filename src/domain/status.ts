// 状态判定纯函数（从 render 流程中抽出的无 DOM 比较逻辑）

import { normalizeFormat } from '../utils/format.js';
import { normalizeText } from '../utils/text.js';
import type { FormatName, Profile } from '../types.js';

export interface EditorState {
    format: unknown;
    url: unknown;
    model: unknown;
    modelBaseline: unknown;
    keyValue: unknown;
}

export function editorHasUnsavedChanges(profile: Profile | null, editor: EditorState): boolean {
    if (!profile) return false;
    return normalizeFormat(editor.format) !== profile.format
        || normalizeText(editor.url) !== normalizeText(profile.endpoint)
        || normalizeText(editor.model) !== normalizeText(editor.modelBaseline)
        || Boolean(normalizeText(editor.keyValue));
}

export function proxyModeForFormat(format: FormatName, endpoint: unknown): boolean {
    return format !== 'openai' && Boolean(normalizeText(endpoint));
}
