// 独立流兜底路由决策（纯函数，无 ST 依赖，便于单元测试）。
// JS-Slash-Runner 等插件走独立请求流：只发 CHAT_COMPLETION_SETTINGS_READY、不发 GENERATION_STARTED，
// state.active 为空。此时用当前 Group 逻辑模型选路，接管连接字段。

import { routeGroupOnce, type GroupRouteUnit } from '../domain/group-routing.js';
import type { Group, Vendor } from '../types.js';

export interface FallbackRouteInput {
    type: string;
    routingEnabled: boolean;
    activeGroupId: string | null;
    groups: Group[];
    vendors: Vendor[];
    /** 可选覆盖逻辑模型 id（默认取 active group 的 currentLogicalModelId）。 */
    logicalModelId?: string;
}

export interface FallbackRouteResult {
    unit: GroupRouteUnit | null;
    skipReason: string | null;
}

export interface ActiveRoutingContextInput {
    routingEnabled: boolean;
    activeGroupId: string | null;
    groups: Group[];
    logicalModelId?: string;
}

/** 解析后的有效路由上下文，或一个跳过原因。供兜底路由与手动锁定复用同一套前置校验。 */
export type ActiveRoutingContext =
    | { group: Group; logicalModelId: string }
    | { skipReason: string };

export function resolveActiveRoutingContext(input: ActiveRoutingContextInput): ActiveRoutingContext {
    if (!input.routingEnabled) return { skipReason: 'routing disabled' };
    const group = input.groups.find(item => item.id === input.activeGroupId) || input.groups[0] || null;
    if (!group || !group.enabled) return { skipReason: 'no active/enabled group' };
    const logicalModelId = input.logicalModelId ?? group.currentLogicalModelId;
    if (!logicalModelId) return { skipReason: 'no logical model' };
    return { group, logicalModelId };
}

export function resolveFallbackRoute(input: FallbackRouteInput): FallbackRouteResult {
    if (input.type === 'quiet' || input.type === 'continue' || input.type === 'impersonate') {
        return { unit: null, skipReason: 'non-user type' };
    }
    const ctx = resolveActiveRoutingContext(input);
    if ('skipReason' in ctx) return { unit: null, skipReason: ctx.skipReason };
    const result = routeGroupOnce(input.vendors, ctx.group, ctx.logicalModelId);
    if (!result.unit) {
        return { unit: null, skipReason: `no route unit: ${result.reasons.join(';') || 'no candidates'}` };
    }
    return { unit: result.unit, skipReason: null };
}