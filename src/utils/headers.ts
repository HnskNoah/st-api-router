// 自定义 Headers 解析（纯函数）

import { normalizeText } from './text.js';

export function parseCustomHeaders(value: unknown): Record<string, string> {
    if (!normalizeText(value)) return {};
    try {
        const parsed: unknown = JSON.parse(String(value));
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return {};
        return Object.fromEntries(Object.entries(parsed).filter(([key, item]) => key && typeof item === 'string'));
    } catch {
        return {};
    }
}
