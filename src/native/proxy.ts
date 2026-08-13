// Reverse Proxy Preset 绑定

import { extension_settings } from '@sillytavern/scripts/extensions';
import { proxies } from '@sillytavern/scripts/openai';
import { sanitizeName } from '../utils/text.js';
import { profiles } from '../settings/access.js';
import type { Profile } from '../types.js';

export function getBoundProxyPreset(profile: Pick<Profile, 'proxyPreset'> | null): { name: string; url?: string; password?: string } | null {
    if (!profile?.proxyPreset) return null;
    return proxies.find(proxy => proxy.name === profile.proxyPreset) || null;
}

export function ensureProxyPresetOption(name: string): void {
    if (!$('#openai_proxy_preset option').filter((_, option) => (option as HTMLOptionElement).value === name).length) {
        $('#openai_proxy_preset').append($('<option>').val(name).text(name));
    }
}

export function proxyPresetIsShared(name: string, ownerProfileId: string): boolean {
    const usedByOtherQuickerProfile = profiles().some(profile => profile.id !== ownerProfileId && profile.proxyPreset === name);
    const usedByConnectionManager = Array.isArray(extension_settings?.connectionManager?.profiles)
        && extension_settings.connectionManager.profiles.some(profile => profile?.proxy === name);
    return usedByOtherQuickerProfile || usedByConnectionManager;
}

export function ensureBoundProxyPreset(profileName: string, endpoint: string, password: string, existingName = '', ownerProfileId = ''): string {
    if (!endpoint) return '';
    const existing = existingName ? proxies.find(proxy => proxy.name === existingName) : null;
    const canUpdateExisting = existing
        && existing.name.startsWith('Quicker · ')
        && !proxyPresetIsShared(existing.name, ownerProfileId);
    if (canUpdateExisting) {
        existing.url = endpoint;
        existing.password = password;
        ensureProxyPresetOption(existing.name);
        return existing.name;
    }
    const base = `Quicker · ${sanitizeName(profileName) || 'Proxy'}`;
    let name = base;
    let index = 2;
    while (proxies.some(proxy => proxy.name === name)) name = `${base} (${index++})`;
    proxies.push({ name, url: endpoint, password });
    ensureProxyPresetOption(name);
    return name;
}
