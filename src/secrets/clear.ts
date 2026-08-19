// Secret 标签清理纯函数（无宿主依赖，可独立测试）。

export const QUICK_API_SECRET_LABEL_PREFIX = 'quicker-api:';

/** 筛选出 label 以 quicker-api: 开头的 secret 条目 id（这些是插件模型拉取/路由时写入的临时 Key）。 */
export function clearableQuickApiSecretIds(entries: Array<{ id: string; label?: string }> | undefined): string[] {
    return (entries || [])
        .filter(entry => String(entry?.label || '').startsWith(QUICK_API_SECRET_LABEL_PREFIX))
        .map(entry => String(entry?.id || ''))
        .filter(Boolean);
}
