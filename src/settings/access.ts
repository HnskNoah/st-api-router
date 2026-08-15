// 设置访问器（宿主 extension_settings 读写）

import { extension_settings } from '@sillytavern/scripts/extensions';
import { oai_settings } from '@sillytavern/scripts/openai';
import { MODULE_NAME } from '../constants.js';
import { normalizeText } from '../utils/text.js';
import type { Group, LogicalModel, Profile, Provider, QuickerApiSettings, RoutingSettings, Vendor } from '../types.js';

export function settings(): QuickerApiSettings {
    return extension_settings[MODULE_NAME] as QuickerApiSettings;
}

export function profiles(): Profile[] {
    return settings().profiles;
}

export function providers(): Provider[] {
    return settings().providers;
}

export function vendors(): Vendor[] {
    return settings().vendors;
}

export function logicalModels(): LogicalModel[] {
    return settings().logicalModels;
}

export function groups(): Group[] {
    return settings().groups;
}

export function activeGroup(): Group | null {
    const id = settings().activeGroupId;
    return groups().find(group => group.id === id) || groups()[0] || null;
}

export function routingSettings(): RoutingSettings {
    return settings().routing;
}

export function selectedProfile(): Profile | null {
    const id = String($('#quicker_api_profile_select').val() || '');
    return profiles().find(profile => profile.id === id) || null;
}

export function currentPresetName(): string {
    return normalizeText(oai_settings.preset_settings_openai || $('#settings_preset_openai option:selected').text());
}

export function getBlockedSecretMessage(key: string): string {
    return String(settings().blockedSecretKeys[key] || '');
}

export function hasBlockedSecrets(): boolean {
    return Object.keys(settings().blockedSecretKeys).length > 0;
}

export function presetBindingFor(presetName: string): string | undefined {
    return settings().presetBindings[presetName];
}
