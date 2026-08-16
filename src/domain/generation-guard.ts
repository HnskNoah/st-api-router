// 生成阻断哨兵：guard 阻断时写入的 source 值，路由拦截必须尊重它们，不得覆盖。
// 纯常量/谓词，无 ST 依赖，便于单元测试与跨模块复用（apply/guard 与 routing/hooks）。

export const BLOCKED_SOURCE_PRESET_TRANSITION = 'quicker_api_preset_transition';
export const BLOCKED_SOURCE_SAFETY = 'quicker_api_safety_blocked';

/** 判断 generateData.chat_completion_source 是否已被 guard 阻断（预设切换中 / 密钥安全阻断）。 */
export function isGenerationBlockedByGuard(source: unknown): boolean {
    return source === BLOCKED_SOURCE_PRESET_TRANSITION || source === BLOCKED_SOURCE_SAFETY;
}
