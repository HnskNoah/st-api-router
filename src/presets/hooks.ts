// 预设联动事件钩子

import { saveSettingsDebounced } from '@sillytavern/script';
import { runtimeState } from '../state.js';
import { settings, profiles, currentPresetName } from '../settings/access.js';
import { normalizeText } from '../utils/text.js';
import { enqueueOperation } from '../operation-queue.js';
import { applyProfile } from '../apply/profile.js';
import { beginPresetTransition, endPresetTransition } from './transition.js';
import { renderProfiles, setStatus } from '../ui/render.js';

export function handleNativePresetChangeBefore({ presetName }: { presetName?: string } = {}): Promise<unknown> | undefined {
    if (runtimeState.extensionDisabled) return undefined;
    const generation = ++runtimeState.profileSelectionGeneration;
    clearTimeout(runtimeState.presetChangeTimer ?? undefined);
    beginPresetTransition();
    const name = normalizeText(presetName || currentPresetName());
    const profile = profiles().find(item => item.id === settings().presetBindings[name]);
    if (profile) {
        settings().selectedProfileId = profile.id;
        saveSettingsDebounced();
        renderProfiles(profile.id);
    }
    return enqueueOperation(async () => {
        if (profile && generation === runtimeState.profileSelectionGeneration) {
            await applyProfile(profile, generation, true, false);
        }
    });
}

export async function handleNativePresetChange(): Promise<boolean | undefined> {
    if (runtimeState.extensionDisabled) return false;
    beginPresetTransition();
    const generation = ++runtimeState.profileSelectionGeneration;
    const quickActionOwnsBlock = Boolean(runtimeState.quickActionBlockingToken);
    clearTimeout(runtimeState.presetChangeTimer ?? undefined);
    const presetName = currentPresetName();
    const profileId = settings().presetBindings[presetName];
    const profile = profiles().find(item => item.id === profileId);
    try {
        if (!profile) {
            settings().activeProfileId = null;
            saveSettingsDebounced();
            renderProfiles(settings().selectedProfileId);
            setStatus('当前 preset 未绑定。', 'warning');
            return false;
        }
        return await enqueueOperation(async () => {
            if (generation !== runtimeState.profileSelectionGeneration) return false;
            const applied = await applyProfile(profile, generation, true, false);
            if (!applied) setStatus('所选 Profile 未应用。', 'warning');
            return applied;
        });
    } finally {
        if (!quickActionOwnsBlock) endPresetTransition();
    }
}

export function handlePresetRenamed({ apiId, oldName, newName }: { apiId?: string; oldName?: string; newName?: string } = {}): void {
    if (runtimeState.extensionDisabled || apiId !== 'openai' || !oldName || !newName) return;
    const profileId = settings().presetBindings[oldName];
    if (!profileId) return;
    delete settings().presetBindings[oldName];
    settings().presetBindings[newName] = profileId;
    saveSettingsDebounced();
    renderProfiles(settings().selectedProfileId);
}

export function handlePresetDeleted({ apiId, name }: { apiId?: string; name?: string } = {}): void {
    if (runtimeState.extensionDisabled || apiId !== 'openai' || !name || !settings().presetBindings[name]) return;
    delete settings().presetBindings[name];
    saveSettingsDebounced();
    renderProfiles(settings().selectedProfileId);
}
