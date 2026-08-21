// 中栏：路由详情（选中逻辑模型后的具体路由列表）。
// 纯渲染函数，由 console-panel.ts 调用。

import { logicalModels } from '../../settings/access.js';
import { recordModelSuccess } from '../../domain/model-health.js';
import { modelStatus, routeHealth, formatDur, saveSettingsNow } from './console-helpers.js';

/** 渲染路由详情到 detailEl 容器。 */
export function renderRouteDetail(
    detailEl: JQuery<HTMLElement> | null,
    selectedLogicalId: string | null,
    onClose: () => void,
    onRefresh: () => void,
): void {
    if (!detailEl) return;
    detailEl.empty();
    if (!selectedLogicalId) {
        detailEl.append($('<div class="csl-empty">').text('在左侧选择一个逻辑模型查看路由详情。'));
        return;
    }
    const model = logicalModels().find(m => m.id === selectedLogicalId);
    const head = $('<div class="csl-detail-head"></div>').append(
        $('<span class="csl-detail-title">').text(model?.name ?? '路由详情'),
        $('<button class="menu_button" type="button" title="关闭返回"><i class="fa-solid fa-xmark"></i></button>').on('click', () => { onClose(); }),
    );
    detailEl.append(head);
    const status = modelStatus(selectedLogicalId);
    const now = Date.now();
    const units = [...status.units].sort((a, b) => {
        const ha = routeHealth(a, now).state, hb = routeHealth(b, now).state;
        const rank = { healthy: 0, cooldown: 1, disabled: 2 };
        return (rank[ha] ?? 3) - (rank[hb] ?? 3);
    });
    if (units.length === 0) {
        detailEl.append($('<div class="csl-empty">').text('该逻辑模型未配置任何 Key 映射。'));
        return;
    }
    const list = $('<div class="csl-route-list"></div>');
    for (const unit of units) {
        const h = routeHealth(unit, now);
        const pill = $('<div class="csl-route-row"></div>');
        const rowName = $('<span class="csl-route-name"></span>').text(`${unit.vendor.name} · ${unit.entry.label} · ${unit.realModel}`);
        const keyWeight = Number(unit.entry.weight) > 0 ? Number(unit.entry.weight) : 1;
        const mappingWeight = Number(unit.mapping.weight) > 0 ? Number(unit.mapping.weight) : 1;
        const weights = $('<span class="csl-route-weights"></span>').text(`Key ${keyWeight} × 模型 ${mappingWeight} = ${keyWeight * mappingWeight}`);
        const mappingWeightInput = $('<input class="text_pole csl-route-weight" type="number" min="0.01" step="0.1" title="真实模型映射权重" aria-label="真实模型映射权重">')
            .val(mappingWeight)
            .on('change', function () {
                const value = Number($(this).val());
                unit.mapping.weight = Number.isFinite(value) && value > 0 ? value : 1;
                $(this).val(unit.mapping.weight);
                saveSettingsNow();
                onRefresh();
            });
        pill.append(rowName, weights, mappingWeightInput);
        const remaining = h.remaining != null ? ` · 冷却中 ${formatDur(h.remaining)}` : '';
        const stateText = h.state === 'healthy' ? '🟢' : h.state === 'cooldown' ? `🟡${remaining}` : '🔴';
        pill.append($('<span class="csl-route-state">').text(stateText));
        if (h.state === 'cooldown' || h.state === 'disabled') {
            const resetBtn = $('<button class="menu_button" type="button" title="手动恢复该模型"><i class="fa-solid fa-rotate-left"></i></button>')
                .on('click', () => {
                    if (h.state === 'cooldown') {
                        if (unit.entry.circuitsByModel) delete unit.entry.circuitsByModel[unit.realModel];
                    } else if (h.state === 'disabled') {
                        unit.vendor.enabled = true;
                        unit.entry.enabled = true;
                    }
                    saveSettingsNow();
                    onRefresh();
                });
            pill.append(resetBtn);
        }
        list.append(pill);
    }
    detailEl.append(list);
    // ── 最近失败记录 ──
    const failures = $('<div class="csl-route-failures"></div>');
    const failuresHead = $('<div class="csl-route-failures-head">').text('最近失败记录');
    failures.append(failuresHead);
    let hasFailures = false;
    for (const unit of status.units) {
        const lastError = unit.entry.lastErrorByRealModel?.[unit.realModel];
        const lastKind = unit.entry.lastErrorKindByModel?.[unit.realModel];
        if (!lastError && !lastKind) continue;
        hasFailures = true;
        const row = $('<div class="csl-route-failure-row"></div>');
        const kindLabel = lastKind === 'fatal' ? '不可恢复' : lastKind === 'rate_limited' ? '限流' : lastKind === 'temp' ? '临时错误' : lastKind === 'bad_request' ? '参数错误' : '未知';
        row.append($('<span class="csl-route-failure-unit">').text(`${unit.vendor.name} · ${unit.entry.label} · ${unit.realModel}`));
        row.append($('<span class="csl-route-failure-kind">').text(kindLabel));
        if (lastError) row.append($('<span class="csl-route-failure-msg">').text(lastError.slice(0, 200)));
        failures.append(row);
    }
    if (!hasFailures) {
        failures.append($('<div class="csl-route-failure-empty">').text('暂无失败记录。'));
    }
    detailEl.append(failures);
}