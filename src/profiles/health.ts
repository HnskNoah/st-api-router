// Profile 健康检查：扫描引用不存在的密钥、空密钥等脏数据

import { readAuthoritativeSecretState } from '../secrets/api.js';
import { getSecretEntry } from '../secrets/access.js';
import { settings, profiles } from '../settings/access.js';
import { saveSettingsDebounced } from '@sillytavern/script';
import { FORMATS } from '../constants.js';
import { renderProfiles } from '../ui/render.js';
import type { Profile } from '../types.js';

export interface ProfileHealthIssue {
    profile: Profile;
    issue: 'missing-secret' | 'empty-secret' | 'secret-exposure-denied';
    detail: string;
}

export async function checkProfileHealth(): Promise<ProfileHealthIssue[]> {
    const issues: ProfileHealthIssue[] = [];
    const authoritative = await readAuthoritativeSecretState();
    const allProfiles = profiles();

    for (const profile of allProfiles) {
        if (!profile.secretId) continue;
        const config = FORMATS[profile.format];
        if (!config) continue;

        // 检查 secret 是否在权威状态中存在
        const entry = getSecretEntry(config.secretKey, profile.secretId);
        if (!entry) {
            issues.push({
                profile,
                issue: 'missing-secret',
                detail: `密钥 ID ${profile.secretId} 在服务端已不存在`,
            });
            continue;
        }

        // 检查是否为安全空密钥
        if (profile.secretId === settings().emptySecretIds[config.secretKey]) {
            issues.push({
                profile,
                issue: 'empty-secret',
                detail: '绑定了安全空密钥（无实际凭据）',
            });
        }
    }

    return issues;
}

export function deleteStaleProfiles(profileIds: string[]): void {
    const all = settings().profiles;
    const idSet = new Set(profileIds);
    settings().profiles = all.filter(p => !idSet.has(p.id));
    // 清理 preset 绑定
    for (const key of Object.keys(settings().presetBindings)) {
        if (idSet.has(settings().presetBindings[key])) delete settings().presetBindings[key];
    }
    saveSettingsDebounced();
    renderProfiles(settings().selectedProfileId);
}