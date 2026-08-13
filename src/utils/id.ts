// ID 生成

export function makeId(prefix = 'profile'): string {
    return globalThis.crypto?.randomUUID
        ? `${prefix}-${globalThis.crypto.randomUUID()}`
        : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
