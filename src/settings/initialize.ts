// 设置初始化与迁移（来自 index.js initializeSettings）

import { extension_settings } from '@sillytavern/scripts/extensions';
import { saveSettingsDebounced } from '@sillytavern/script';
import { SECRET_KEYS } from '@sillytavern/scripts/secrets';
import {
    DEFAULT_SETTINGS, FORMATS, LEGACY_MODULE_NAME, MODULE_NAME, SCHEMA_VERSION,
} from '../constants.js';
import { normalizeProfile } from '../domain/profile.js';
import { normalizeQuickAction } from '../domain/quick-action.js';
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
    value.emptySecretIds = value.emptySecretIds && typeof value.emptySecretIds === 'object' ? value.emptySecretIds : {};
    value.presetBindings = value.presetBindings && typeof value.presetBindings === 'object' ? value.presetBindings : {};
    value.blockedSecretKeys = value.blockedSecretKeys && typeof value.blockedSecretKeys === 'object' ? value.blockedSecretKeys : {};
    value.quickActionPlacement = ['leftSendForm', 'rightSendForm', 'qrButtons', 'disabled'].includes(value.quickActionPlacement)
        ? value.quickActionPlacement
        : 'rightSendForm';
    value.quickActions = Array.isArray(value.quickActions)
        ? value.quickActions.map(normalizeQuickAction).filter(action => action.preset || action.profileId || action.model)
        : [];
    value.quickActions.sort((a, b) => a.sequence - b.sequence).forEach((action, index) => { action.sequence = index; });
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
