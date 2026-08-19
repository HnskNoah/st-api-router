// 设置初始化与迁移（来自 index.js initializeSettings）

import { extension_settings } from '@sillytavern/scripts/extensions';
import { saveSettingsDebounced } from '@sillytavern/script';
import { SECRET_KEYS } from '@sillytavern/scripts/secrets';
import {
    DEFAULT_SETTINGS, FORMATS, LEGACY_MODULE_NAME, MODULE_NAME, SCHEMA_VERSION,
} from '../constants.js';
import { normalizeProfile } from '../domain/profile.js';
import { normalizeQuickAction } from '../domain/quick-action.js';
import { normalizeProviders, providerFromProfile, resetRoutingRuntimeState } from '../domain/provider.js';
import {
    allGroupEntries,
    canonicalModelName,
    migrateProvidersToVendorModel,
    normalizeGroups,
    normalizeLogicalModels,
    normalizeMappingRules,
    normalizeVendors,
    resetGroupRuntimeState,
    resetVendorRuntimeState,
} from '../domain/vendor.js';
import { normalizeRoutingSettings } from '../domain/routing.js';
import { sanitizeName } from '../utils/text.js';

export function initializeSettings(): boolean {
    let changed = false;
    if (!extension_settings[MODULE_NAME] || typeof extension_settings[MODULE_NAME] !== 'object') {
        extension_settings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
        changed = true;
    }
    const value = extension_settings[MODULE_NAME];
    const storedVersion = Number(value.schemaVersion || 0);
    if (storedVersion > SCHEMA_VERSION) {
        toastr.error('Quicker Api 数据来自更高版本。当前扩展保持停用以避免损坏配置。');
        return false;
    }

    if (!value.migratedFromCustomOpenAIProfiles) {
        const legacy = extension_settings[LEGACY_MODULE_NAME];
        if (legacy && typeof legacy === 'object' && Array.isArray(legacy.profiles) && !Array.isArray(value.profiles)) {
            value.profiles = structuredClone(legacy.profiles);
            value.activeProfileId = legacy.activeProfileId || null;
            value.selectedProfileId = legacy.activeProfileId || null;
            value.emptySecretIds = legacy.emptySecretId ? { [SECRET_KEYS.CUSTOM]: String(legacy.emptySecretId) } : {};
        } else if (legacy && typeof legacy === 'object' && Array.isArray(legacy.profiles) && (!value.profiles || value.profiles.length === 0)) {
            value.profiles = structuredClone(legacy.profiles);
            value.activeProfileId = legacy.activeProfileId || null;
            value.selectedProfileId = legacy.activeProfileId || null;
            value.emptySecretIds = legacy.emptySecretId ? { [SECRET_KEYS.CUSTOM]: String(legacy.emptySecretId) } : {};
        }
        value.migratedFromCustomOpenAIProfiles = true;
        changed = true;
    }

    value.profiles = Array.isArray(value.profiles) ? value.profiles.map(profile => normalizeProfile(profile)) : [];
    // ── st-api-router：providers 迁移（v11）──
    // 旧 profiles → providers：保留 id 兼容引用；profiles 保留（Profile UI 仍在，Provider 面板与其共存）。
    value.providers = normalizeProviders(value.providers);
    // 运行时状态（窗口/熔断/失败计数）不跨会话：载入即重置
    resetRoutingRuntimeState(value.providers);
    if (storedVersion < 11 && value.providers.length === 0 && value.profiles.length > 0) {
        value.providers = value.profiles.map(profile => providerFromProfile(profile));
        changed = true;
    }

    // ── Vendor / LogicalModel / Group（v12）──
    value.vendors = normalizeVendors(value.vendors);
    value.logicalModels = normalizeLogicalModels(value.logicalModels);
    value.groups = normalizeGroups(value.groups);
    resetVendorRuntimeState(value.vendors);
    resetGroupRuntimeState(value.groups);
    if (storedVersion < 12 && value.vendors.length === 0 && value.providers.length > 0) {
        const migrated = migrateProvidersToVendorModel(value.providers);
        value.vendors = migrated.vendors;
        value.logicalModels = migrated.logicalModels;
        value.groups = migrated.groups;
        changed = true;
    }
    if (value.groups.some(group => group.entries.length > 0)) {
        const known = new Set(value.logicalModels.map(model => model.id));
        let added = false;
        for (const entry of allGroupEntries(value.groups)) {
            for (const mapping of entry.mappings) {
                if (!known.has(mapping.logicalModelId)) {
                    // 补建逻辑模型：名字用真实模型的核心名（剥渠道/变体前缀），不用 id 当名字
                    const name = canonicalModelName(mapping.realModel) || mapping.logicalModelId;
                    value.logicalModels.push({ id: mapping.logicalModelId, name, matchPattern: '' });
                    known.add(mapping.logicalModelId);
                    added = true;
                }
            }
        }
        if (added) changed = true;
    }
    const normalizedActiveGroupId = value.groups.some(group => group.id === value.activeGroupId)
        ? value.activeGroupId
        : (value.groups[0]?.id || null);
    if (value.activeGroupId !== normalizedActiveGroupId) changed = true;
    value.activeGroupId = normalizedActiveGroupId;

    value.routing = normalizeRoutingSettings(value.routing);
    value.emptySecretIds = value.emptySecretIds && typeof value.emptySecretIds === 'object' ? value.emptySecretIds : {};
    value.presetBindings = value.presetBindings && typeof value.presetBindings === 'object' ? value.presetBindings : {};
    value.blockedSecretKeys = value.blockedSecretKeys && typeof value.blockedSecretKeys === 'object' ? value.blockedSecretKeys : {};
    value.quickActionPlacement = ['leftSendForm', 'rightSendForm', 'qrButtons', 'disabled'].includes(value.quickActionPlacement)
        ? value.quickActionPlacement
        : 'rightSendForm';
    value.quickActions = Array.isArray(value.quickActions)
        ? value.quickActions.map(normalizeQuickAction).filter(action => action.preset || action.model)
        : [];
    value.quickActions.sort((a, b) => a.sequence - b.sequence).forEach((action, index) => { action.sequence = index; });
    value.mappingRules = normalizeMappingRules(value.mappingRules);
    value.ignoredModels = Array.isArray(value.ignoredModels)
        ? value.ignoredModels.map(item => String(item || '').trim()).filter(Boolean)
        : [];
    for (const key of Object.keys(value.blockedSecretKeys)) {
        if (!Object.values(FORMATS).some(config => config.secretKey === key)) delete value.blockedSecretKeys[key];
    }
    value.activeProfileId = value.profiles.some(profile => profile.id === value.activeProfileId) ? value.activeProfileId : null;
    const normalizedSelectedProfileId = value.profiles.some(profile => profile.id === value.selectedProfileId)
        ? value.selectedProfileId
        : value.activeProfileId;
    if (value.selectedProfileId !== normalizedSelectedProfileId) changed = true;
    value.selectedProfileId = normalizedSelectedProfileId;
    value.schemaVersion = SCHEMA_VERSION;

    for (const [name, profileId] of Object.entries(value.presetBindings)) {
        if (!sanitizeName(name) || !value.profiles.some(profile => profile.id === profileId)) {
            delete value.presetBindings[name];
            changed = true;
        }
    }
    if (storedVersion !== SCHEMA_VERSION) changed = true;
    if (changed) saveSettingsDebounced();
    return true;
}
