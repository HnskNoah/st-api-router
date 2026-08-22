// 中栏：路由详情（选中逻辑模型后的具体路由列表）。
// 纯渲染函数，由 console-panel.ts 调用。

import { Popup } from '@sillytavern/scripts/popup';
import { groups, logicalModels, settings, vendors } from '../../settings/access.js';
import { modelStatus, routeHealth, formatDur, formatClock, saveSettingsNow } from './console-helpers.js';

let observationFilter: 'all' | 'error' | 'empty' = 'all';
let observationScope: 'global' | 'model' = 'global';

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
        $('<button class="csl-btn csl-btn--icon" type="button" title="关闭返回"><i class="fa-solid fa-xmark"></i></button>').on('click', () => { onClose(); }),
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
            const resetBtn = $('<button class="csl-btn csl-btn--secondary" type="button" title="手动恢复该模型"><i class="fa-solid fa-rotate-left"></i></button>')
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
    // ── 最近错误与结果观测（全局滑动窗口，支持筛选/清空） ──
    const failures = $('<div class="csl-route-failures"></div>');
    const failuresHead = $('<div class="csl-route-failures-head">').text('最近错误与结果观测（最新 200 条）');
    const mkKindChip = (label: string, value: 'all' | 'error' | 'empty') => $('<span class="csl-obs-chip">')
        .toggleClass('is-active', observationFilter === value).text(label)
        .on('click', () => { observationFilter = value; onRefresh(); });
    const mkScopeChip = (label: string, value: 'global' | 'model') => $('<span class="csl-obs-chip">')
        .toggleClass('is-active', observationScope === value).text(label)
        .on('click', () => { observationScope = value; onRefresh(); });
    const chipRow = $('<div class="csl-obs-chips"></div>');
    chipRow.append(
        mkKindChip('全部', 'all'),
        mkKindChip('仅错误', 'error'),
        mkKindChip('仅空回复', 'empty'),
        $('<span class="csl-obs-sep"></span>'),
        mkScopeChip('全局', 'global'),
        mkScopeChip('当前模型', 'model'),
    );
    failuresHead.append(chipRow);
    const clearBtn = $('<button class="csl-btn csl-btn--icon" type="button" title="清空观测历史"><i class="fa-solid fa-trash"></i></button>')
        .on('click', async () => {
            const confirmed = await Popup.show.confirm('清空观测历史', '确定清空全部错误与结果观测记录？');
            if (!confirmed) return;
            const history = settings().observationHistory;
            if (history) history.splice(0, history.length);
            saveSettingsNow();
            onRefresh();
        });
    failuresHead.append(clearBtn);
    failures.append(failuresHead, chipRow);
    let history = [...(settings().observationHistory ?? [])].sort((a, b) => b.occurredAt - a.occurredAt);
    if (observationFilter === 'error') history = history.filter(rec => rec.kind !== 'empty_response');
    if (observationFilter === 'empty') history = history.filter(rec => rec.kind === 'empty_response');
    if (observationScope === 'model' && selectedLogicalId) {
        history = history.filter(rec => rec.logicalModelId === selectedLogicalId);
    }
    const vendorName = (id: string) => vendors().find(v => v.id === id)?.name ?? id;
    const entryLabel = (entryId: string) => {
        for (const group of groups()) {
            const entry = group.entries.find(item => item.id === entryId);
            if (entry) return entry.label;
        }
        return entryId;
    };
    const kindLabel = (kind: string) => kind === 'fatal' ? '不可恢复' : kind === 'rate_limited' ? '限流' : kind === 'temp' ? '临时错误' : kind === 'bad_request' ? '参数错误' : kind === 'empty_response' ? '空回复（不计失败）' : '未知';
    if (history.length === 0) {
        failures.append($('<div class="csl-route-failure-empty">').text('暂无匹配的观测记录。'));
    } else {
        for (const rec of history) {
            const row = $('<div class="csl-route-failure-row"></div>');
            row.append($('<span class="csl-route-failure-time">').text(formatClock(rec.occurredAt)));
            row.append($('<span class="csl-route-failure-unit">').text(`${vendorName(rec.vendorId)} · ${entryLabel(rec.entryId)} · ${rec.realModel}`));
            row.append($('<span class="csl-route-failure-kind">').text(kindLabel(rec.kind)));
            if (rec.message) row.append($('<span class="csl-route-failure-msg">').text(rec.message.slice(0, 200)));
            failures.append(row);
        }
    }
    detailEl.append(failures);
}