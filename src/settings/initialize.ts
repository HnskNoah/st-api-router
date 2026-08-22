// 设置初始化和规范（Vendor / LogicalModel / Group 领域）

import { extension_settings } from '@sillytavern/scripts/extensions';
import { saveSettingsDebounced } from '@sillytavern/script';
import {
    FORMATS, MODULE_NAME, SCHEMA_VERSION, normalizeRoutingSettings,
} from '../constants.js';
import { normalizeQuickAction } from '../domain/quick-action.js';
import {
    normalizeGroups,
    normalizeLogicalModels,
    normalizeMappingRules,
    normalizeObservationHistory,
    normalizeVendors,
    resetGroupRuntimeState,
    resetVendorRuntimeState,
} from '../domain/vendor.js';

export function initializeSettings(): boolean {
    let changed = false;
    if (!extension_settings[MODULE_NAME] || typeof extension_settings[MODULE_NAME] !== 'object') {
        extension_settings[MODULE_NAME] = {};
        changed = true;
    }
    const value = extension_settings[MODULE_NAME];
    const storedVersion = Number(value.schemaVersion || 0);
    if (storedVersion > SCHEMA_VERSION) {
        console.warn(`[QuickerApi] stored schemaVersion ${storedVersion} > expected ${SCHEMA_VERSION}; forward-compat mode`);
        return true;
    }

    // ── Vendor / LogicalModel / Group ──
    value.vendors = normalizeVendors(value.vendors);
    value.logicalModels = normalizeLogicalModels(value.logicalModels);
    value.groups = normalizeGroups(value.groups);
    resetVendorRuntimeState(value.vendors);
    resetGroupRuntimeState(value.groups);

    // 确保至少一个分组
    if (value.groups.length === 0) {
        value.groups = normalizeGroups([{ name: '默认分组', enabled: true, currentLogicalModelId: '', entries: [] }]);
        changed = true;
    }

    // 清理旧版遗留字段（无数据迁移，直接丢弃）
    delete value.profiles;
    delete value.providers;
    delete value.presetBindings;
    delete value.selectedProfileId;
    delete value.activeProfileId;
    delete value.migratedFromCustomOpenAIProfiles;

    const normalizedActiveGroupId = value.groups.some(group => group.id === value.activeGroupId)
        ? value.activeGroupId
        : (value.groups[0]?.id || null);
    if (value.activeGroupId !== normalizedActiveGroupId) changed = true;
    value.activeGroupId = normalizedActiveGroupId;

    value.routing = normalizeRoutingSettings(value.routing);
    value.emptySecretIds = value.emptySecretIds && typeof value.emptySecretIds === 'object' ? value.emptySecretIds : {};
    value.blockedSecretKeys = value.blockedSecretKeys && typeof value.blockedSecretKeys === 'object' ? value.blockedSecretKeys : {};
    value.quickActionPlacement = ['leftSendForm', 'rightSendForm', 'qrButtons', 'disabled'].includes(value.quickActionPlacement)
        ? value.quickActionPlacement
        : 'rightSendForm';
    // 不按 preset/model 过滤：管理界面「新增方案」会先保存未配置条目（显示为 方案N · 未配置），
    // 持久化路径也保留它们；载入时过滤会导致重开后静默丢数据。
    value.quickActions = Array.isArray(value.quickActions)
        ? value.quickActions.map(normalizeQuickAction)
        : [];
    value.quickActions.sort((a, b) => a.sequence - b.sequence).forEach((action, index) => { action.sequence = index; });
    value.mappingRules = normalizeMappingRules(value.mappingRules);
    value.observationHistory = normalizeObservationHistory(value.observationHistory);
    value.ignoredModels = Array.isArray(value.ignoredModels)
        ? value.ignoredModels.map(item => String(item || '').trim()).filter(Boolean)
        : [];
    for (const key of Object.keys(value.blockedSecretKeys)) {
        if (!Object.values(FORMATS).some(config => config.secretKey === key)) delete value.blockedSecretKeys[key];
    }
    value.schemaVersion = SCHEMA_VERSION;

    if (storedVersion !== SCHEMA_VERSION) changed = true;
    if (changed) saveSettingsDebounced();
    return true;
}