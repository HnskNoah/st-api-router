// 手动路由决策（纯函数，无 ST 依赖，便于单元测试）。
// 手动路由按钮触发：按当前分组逻辑模型选一个 Vendor/Key，写进 ST 连接字段并提示结果。

import { resolveFallbackRoute } from './fallback.js';
import type { GroupRouteUnit } from '../domain/group-routing.js';
import type { Group, Vendor } from '../types.js';

export interface ManualRouteOutcome {
    unit: GroupRouteUnit | null;
    toastrType: 'info' | 'warning';
    toastrTitle: string;
    toastrText: string;
}

export interface ManualRouteInput {
    routingEnabled: boolean;
    activeGroupId: string | null;
    groups: Group[];
    vendors: Vendor[];
}

export function manualRouteSkipMessage(reason: string | null): string {
    switch (reason) {
        case 'routing disabled':
            return '路由未启用，无法手动路由。';
        case 'no active/enabled group':
            return '当前没有启用的分组。';
        case 'no logical model':
            return '当前分组尚未选择逻辑模型。';
        default:
            return `手动路由失败：${reason || '无可用 Vendor'}。`;
    }
}

export function resolveManualRouteOutcome(input: ManualRouteInput): ManualRouteOutcome {
    const result = resolveFallbackRoute({ type: 'normal', ...input });
    if (!result.unit) {
        return {
            unit: null,
            toastrType: 'warning',
            toastrTitle: '手动路由',
            toastrText: manualRouteSkipMessage(result.skipReason),
        };
    }
    const { vendor, entry, realModel } = result.unit;
    return {
        unit: result.unit,
        toastrType: 'info',
        toastrTitle: '手动路由',
        toastrText: `${vendor.name} / ${entry.label} / ${realModel}`,
    };
}