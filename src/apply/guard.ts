// 生成前拦截（密钥状态不确定时阻断）

import { chat_completion_sources } from '@sillytavern/scripts/openai';
import { FORMATS } from '../constants.js';
import { settings } from '../settings/access.js';
import { runtimeState } from '../state.js';
import { debugLog } from '../debug.js';

export function guardGenerationWhenBlocked(generateData: Record<string, any>): void {
    if (runtimeState.extensionDisabled || !generateData || typeof generateData !== 'object') return;
    if (runtimeState.presetTransitionBlocked) {
        generateData.chat_completion_source = 'quicker_api_preset_transition';
        generateData.custom_url = '';
        generateData.reverse_proxy = '';
        debugLog('guardGenerationWhenBlocked blocked by preset transition', {
            source: generateData.chat_completion_source,
            presetTransitionBlocked: true,
        });
        toastr.error('Quicker Api 正在安全切换预设凭据，本次生成已阻断。');
        return;
    }
    const format = Object.values(FORMATS).find(config => config.source === generateData.chat_completion_source);
    if (!format) {
        debugLog('guardGenerationWhenBlocked skip: unknown source', { source: generateData.chat_completion_source });
        return;
    }
    const usesProxyCredential = format.source !== chat_completion_sources.CUSTOM && Boolean(generateData.reverse_proxy);
    if (usesProxyCredential || !settings().blockedSecretKeys[format.secretKey]) {
        debugLog('guardGenerationWhenBlocked pass', {
            source: generateData.chat_completion_source,
            usesProxyCredential,
            blockedKey: settings().blockedSecretKeys[format.secretKey] ?? null,
        });
        return;
    }
    generateData.chat_completion_source = 'quicker_api_safety_blocked';
    generateData.custom_url = '';
    generateData.reverse_proxy = '';
    debugLog('guardGenerationWhenBlocked blocked by secret', {
        source: generateData.chat_completion_source,
        secretKey: format.secretKey,
    });
    toastr.error(settings().blockedSecretKeys[format.secretKey]);
}
