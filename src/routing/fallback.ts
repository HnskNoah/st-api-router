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

export function resolveFallbackRoute(input: FallbackRouteInput): FallbackRouteResult {
    if (input.type === 'quiet' || input.type === 'continue' || input.type === 'impersonate') {
        return { unit: null, skipReason: 'non-user type' };
    }
    if (!input.routingEnabled) {
        return { unit: null, skipReason: 'routing disabled' };
    }
    const activeGroup = input.groups.find(group => group.id === input.activeGroupId) || input.groups[0] || null;
    if (!activeGroup || !activeGroup.enabled) {
        return { unit: null, skipReason: 'no active/enabled group' };
    }
    const logicalModelId = input.logicalModelId ?? activeGroup.currentLogicalModelId;
    if (!logicalModelId) {
        return { unit: null, skipReason: 'no logical model' };
    }
    const result = routeGroupOnce(input.vendors, activeGroup, logicalModelId);
    if (!result.unit) {
        return { unit: null, skipReason: `no route unit: ${result.reasons.join(';') || 'no candidates'}` };
    }
    return { unit: result.unit, skipReason: null };
}
