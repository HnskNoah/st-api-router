// 预设切换期间的连接保护（阻断连接按钮，防止凭据错配）

import { runtimeState } from '../state.js';

export function beginPresetTransition(): void {
    if (!runtimeState.presetTransitionBlocked) runtimeState.presetConnectWasDisabled = Boolean($('#api_button_openai').prop('disabled'));
    runtimeState.presetTransitionBlocked = true;
    $('#api_button_openai').prop('disabled', true);
}

export function endPresetTransition({ force = false }: { force?: boolean } = {}): void {
    if (runtimeState.teardownPending && !force) return;
    if (!runtimeState.presetTransitionBlocked) return;
    runtimeState.presetTransitionBlocked = false;
    $('#api_button_openai').prop('disabled', runtimeState.presetConnectWasDisabled);
}
