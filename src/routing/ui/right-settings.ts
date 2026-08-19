// 右栏：设置标签页（基础路由参数）。
// 纯渲染函数，由 console-panel.ts 调用。

import { routingSettings } from '../../settings/access.js';
import { cslField, cslCheckbox, cslNumber, saveSettingsNow } from './console-helpers.js';

/** 渲染"设置"标签页到 rightEl 容器。 */
export function renderRightSettings(rightEl: JQuery<HTMLElement> | null): void {
    if (!rightEl) return;
    rightEl.empty();
    const routing = routingSettings();
    const rows = $('<div class="csl-settings-group"></div>');
    rows.append(cslField('启用路由', cslCheckbox(routing.enabled, v => { routing.enabled = v; saveSettingsNow(); })));
    rows.append(cslField('保持同一 Vendor（次）', cslNumber(routing.stickyCount, v => { routing.stickyCount = v; saveSettingsNow(); })));
    rows.append(cslField('失败阈值', cslNumber(routing.failThreshold, v => { routing.failThreshold = v; saveSettingsNow(); })));
    rows.append(cslField('冷却时间（秒）', cslNumber(routing.cooldownSeconds, v => { routing.cooldownSeconds = v; saveSettingsNow(); })));
    rightEl.append(rows);
}