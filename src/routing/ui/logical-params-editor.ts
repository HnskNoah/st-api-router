// 逻辑模型附加参数编辑器（左栏仪表盘 / 右栏映射 共用）。
// 编辑 custom_include_body / exclude_body / headers（YAML），仅 custom Vendor 路由时透传。

import { logicalModels } from '../../settings/access.js';
import { normalizeLogicalModel } from '../../domain/vendor.js';
import { showEditorDialog } from './controls.js';
import { saveSettingsNow } from './console-helpers.js';

/** 打开逻辑模型附加参数编辑弹窗。onDone 在保存成功后回调（用于刷新列表等）。 */
export function openLogicalParamsEditor(logicalModelId: string, onDone: () => void): void {
    const model = logicalModels().find(item => item.id === logicalModelId);
    if (!model) return;
    const draft = normalizeLogicalModel(structuredClone(model));
    const content = $('<div class="csl-editor"></div>');
    const includeBodyInput = $('<textarea class="text_pole" rows="4" maxlength="100000" placeholder="YAML，如：top_k: 20\nrepetition_penalty: 1.1"></textarea>').val(draft.customIncludeBody ?? '');
    const excludeBodyInput = $('<textarea class="text_pole" rows="4" maxlength="100000" placeholder="YAML 数组，如：frequency_penalty\npresence_penalty"></textarea>').val(draft.customExcludeBody ?? '');
    const includeHeadersInput = $('<textarea class="text_pole" rows="4" maxlength="100000" placeholder="YAML，如：X-Custom: abc\nAnother-Header: def"></textarea>').val(draft.customIncludeHeaders ?? '');

    content.append(
        $('<div class="csl-empty" style="padding:0 0 6px">').text(`编辑逻辑模型「${model.name}」的路由附加参数。仅当该逻辑模型最终路由到 custom（OpenAI 兼容）Vendor 时才生效。`),
        $('<div style="font-size:12px;color:#999;padding:4px 0 2px">').text('自定义 include body（YAML，路由时透传进请求体）'),
        includeBodyInput,
        $('<div style="font-size:12px;color:#999;padding:8px 0 2px">').text('自定义 exclude body（YAML，从请求体排除这些参数）'),
        excludeBodyInput,
        $('<div style="font-size:12px;color:#999;padding:8px 0 2px">').text('自定义请求头（YAML，附加请求头）'),
        includeHeadersInput,
    );

    showEditorDialog({
        title: `逻辑模型「${model.name}」附加参数`,
        content,
        onSave: () => {
            const normalized = normalizeLogicalModel({
                ...model,
                customIncludeBody: String(includeBodyInput.val() ?? ''),
                customExcludeBody: String(excludeBodyInput.val() ?? ''),
                customIncludeHeaders: String(includeHeadersInput.val() ?? ''),
            });
            Object.assign(logicalModels().find(item => item.id === logicalModelId) ?? {}, normalized);
            saveSettingsNow();
            onDone();
        },
        successMessage: `逻辑模型「${model.name}」的附加参数已保存。`,
    });
}
