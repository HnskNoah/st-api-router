// 模型列表工具（纯函数）

import { normalizeText } from './text.js';

export function normalizeModelList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(item => normalizeText(item).slice(0, 500)).filter(Boolean))].slice(0, 1000);
}

export function modelIdsFromPayload(payload: unknown): string[] {
    const data = payload as { data?: unknown } | null;
    const items = Array.isArray(data?.data) ? data.data : (Array.isArray(payload) ? payload : []);
    return normalizeModelList(items.map(item => typeof item === 'string' ? item : (item as { id?: unknown } | null)?.id));
}
