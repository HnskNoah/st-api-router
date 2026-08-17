// secret 清理纯逻辑：判断哪些条目是插件临时写入、可安全清除的。
// 与 ST 网络无关，便于单元测试。

export const QUICK_API_SECRET_LABEL_PREFIX = 'quicker-api:';

/** 筛选出 label 以 quicker-api: 开头的 secret 条目 id（这些是插件模型拉取/路由时写入的临时 Key）。 */
export function clearableQuickApiSecretIds(entries: Array<{ id: string; label?: string }> | undefined): string[] {
    return (entries || [])
        .filter(entry => String(entry?.label || '').startsWith(QUICK_API_SECRET_LABEL_PREFIX))
        .map(entry => String(entry?.id || ''))
        .filter(Boolean);
}
