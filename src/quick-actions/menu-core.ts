// 便捷方案菜单最小核心（关闭菜单；不依赖其他 quick-action 模块，避免环）

import { runtimeState } from '../state.js';

export function closeQuickActionMenu(): void {
    runtimeState.quickActionPopper?.destroy?.();
    runtimeState.quickActionPopper = null;
    runtimeState.quickActionMenu?.remove();
    runtimeState.quickActionMenu = null;
    $(document).off('.quickerApiMenu');
    $(window).off('.quickerApiMenu');
    if (globalThis.visualViewport) $(globalThis.visualViewport).off('.quickerApiMenu');
}
