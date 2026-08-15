// 纯函数：上下文上限钳制（无宿主依赖，可单测）。

/** 计算钳制后的上下文上限：vendor.maxContext > 0 时才生效；当前值已设则取 min，未设则直接采用 vendor 上限。 */
export function clampContextLimit(current: number | null | undefined, maxContext: number | null | undefined): number {
    const max = Number(maxContext) || 0;
    if (max <= 0) return Number(current) || 0;
    const cur = Number(current) || 0;
    return cur > 0 ? Math.min(cur, max) : max;
}
