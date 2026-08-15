// Quick Action 领域纯函数

import { normalizeText, sanitizeName } from '../utils/text.js';
import { makeId } from '../utils/id.js';
import { QUICK_ACTION_PLACEMENTS } from '../constants.js';
import type { LogicalModel, QuickAction, QuickActionPlacement } from '../types.js';

export function normalizeQuickAction(raw: Record<string, any> | undefined, index = 0): QuickAction {
    return {
        id: normalizeText(raw?.id) || makeId('quick-action'),
        name: sanitizeName(raw?.name),
        preset: normalizeText(raw?.preset).slice(0, 500),
        profileId: normalizeText(raw?.profileId),
        model: normalizeText(raw?.model).slice(0, 500),
        sequence: Number.isFinite(Number(raw?.sequence)) ? Number(raw?.sequence) : index,
    };
}

export function normalizeQuickActionPlacement(value: unknown, fallback: QuickActionPlacement = 'rightSendForm'): QuickActionPlacement {
    return QUICK_ACTION_PLACEMENTS.includes(value as QuickActionPlacement) ? (value as QuickActionPlacement) : fallback;
}

export function quickActionDisplayName(action: Pick<QuickAction, 'name'>, index = 0): string {
    return sanitizeName(action.name) || `方案${index + 1}`;
}

/** 把快捷方案里的模型字段解析为逻辑模型：优先按 id 匹配，其次按 name。 */
export function resolveLogicalModelForAction(model: string, logicalModels: LogicalModel[]): LogicalModel | null {
    const value = normalizeText(model);
    if (!value) return null;
    for (const logical of logicalModels || []) {
        if (logical.id === value) return logical;
    }
    for (const logical of logicalModels || []) {
        if (logical.name === value) return logical;
    }
    return null;
}
