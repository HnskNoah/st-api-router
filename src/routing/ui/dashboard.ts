// 左栏：逻辑模型仪表盘（健康状态 / 最优路由）。
// 纯渲染函数，由 console-panel.ts 调用。

import { logicalModels } from '../../settings/access.js';
import { modelStatus, activeGroup, levelDot } from './console-helpers.js';

/** 渲染逻辑模型仪表盘到 dashboardEl 容器。 */
export function renderDashboard(
    dashboardEl: JQuery<HTMLElement> | null,
    selectedLogicalId: string | null,
    onSelect: (logicalId: string) => void,
): void {
    if (!dashboardEl) return;
    dashboardEl.empty();
    const group = activeGroup();
    if (!group) {
        dashboardEl.append($('<div class="csl-empty">').text('还没有分组，先到路由面板配置。'));
        return;
    }
    const currentId = group?.currentLogicalModelId ?? null;
    const models = [...logicalModels()].sort((a, b) => {
        // 当前分组选中的逻辑模型置顶
        const aPin = a.id === currentId ? 0 : 1;
        const bPin = b.id === currentId ? 0 : 1;
        if (aPin !== bPin) return aPin - bPin;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    for (const model of models) {
        const status = modelStatus(model.id);
        const row = $('<div class="csl-model-row" role="button" tabindex="0"></div>')
            .toggleClass('is-selected', selectedLogicalId === model.id)
            .toggleClass('is-current', model.id === currentId)
            .attr('data-search', model.name.toLowerCase());
        const name = $('<span class="csl-model-name"></span>');
        name.html(`${levelDot(status.level)} <span>${model.name}</span>`);
        const meta = $('<span class="csl-model-meta">').text(status.text);
        const sub = status.best
            ? $('<span class="csl-model-sub">').text(`${status.best.vendor.name} · ${status.best.entry.label} · ${status.best.realModel}`)
            : $('<span class="csl-model-sub csl-model-sub--empty">').text(status.text);
        row.append($('<span class="csl-model-top"></span>').append(name, meta), sub);
        row.on('click', () => { onSelect(model.id); });
        row.on('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.trigger('click'); } });
        dashboardEl.append(row);
        if (status.cooling > 0) dashboardEl.append($('<span class="csl-model-flag">').text(`⚠️ ${model.name} 有 ${status.cooling} 条冷却中`));
    }
    if (models.length === 0) {
        dashboardEl.append($('<div class="csl-empty">').text('还没有逻辑模型。先从路由面板拉取模型并归类，或一键归类。'));
    }
}