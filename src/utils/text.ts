// 纯文本工具函数

export function normalizeText(value: unknown): string {
    return String(value ?? '').trim();
}

export function sanitizeName(value: unknown): string {
    return normalizeText(value).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 120);
}

export function escapeHtml(value: unknown): string {
    const map: Record<string, string> = {
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    };
    return String(value).replace(/[&<>"']/g, character => map[character] ?? character);
}
