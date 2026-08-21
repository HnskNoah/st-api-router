// 手动路由锁定决策（纯函数，无 ST 依赖，便于单元测试）。
// 手动路由按钮触发：按当前分组逻辑模型只读选一个 Vendor/Key（不记录 RPM），
// 锁定到下一次生成；下一次生成消费锁定并记录 RPM，之后恢复随机。

import { resolveActiveRoutingContext } from './fallback.js';
import { candidateGroupUnits, groupUnitUnavailabilityReason, pickGroupUnit, type GroupRouteUnit } from '../domain/group-routing.js';
import type { Group, Vendor } from '../types.js';

export interface ManualLockInput {
    routingEnabled: boolean;
    activeGroupId: string | null;
    groups: Group[];
    vendors: Vendor[];
}

export interface ManualLockResult {
    unit: GroupRouteUnit | null;
    skipReason: string | null;
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

export function resolveManualLock(input: ManualLockInput): ManualLockResult {
    const ctx = resolveActiveRoutingContext(input);
    if ('skipReason' in ctx) return { unit: null, skipReason: ctx.skipReason };
    const unit = pickGroupUnit(candidateGroupUnits(input.vendors, ctx.group, ctx.logicalModelId));
    if (!unit) return { unit: null, skipReason: 'no route unit' };
    return { unit, skipReason: null };
}

/**
 * 锁定的 unit 是否仍适用于当前生成上下文：
 * 属于当前分组、逻辑模型一致、且 Vendor/Key/RPM 仍可用。
 * 分组切换或逻辑模型变化后，旧锁定应失效，回退随机选路。
 */
export function isManualLockApplicable(
    locked: GroupRouteUnit,
    group: Group | null,
    logicalModelId: string,
    now = Date.now(),
): boolean {
    if (!locked || !group || locked.mapping?.logicalModelId !== logicalModelId) return false;
    const currentEntry = group.entries.find(entry => entry.id === locked.entry?.id);
    if (!currentEntry) return false;
    const lockedMappingId = locked.mapping?.id;
    const currentMapping = lockedMappingId
        ? currentEntry.mappings?.find(mapping => mapping.id === lockedMappingId)
        : currentEntry.mappings?.find(mapping => mapping.realModel === locked.realModel && mapping.logicalModelId === logicalModelId);
    if (!currentMapping || currentMapping.logicalModelId !== logicalModelId) return false;
    const currentUnit: GroupRouteUnit = {
        ...locked,
        entry: currentEntry,
        mapping: currentMapping,
        realModel: currentMapping.realModel,
    };
    return !groupUnitUnavailabilityReason(currentUnit, now);
}