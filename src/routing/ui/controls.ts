// 控制台 & 方案管理共用 UI 控件。
// 统一编辑弹窗 / 操作按钮 / select2 封装，供 console-panel、right-*、quick-actions 复用。

import { POPUP_TYPE, Popup } from '@sillytavern/scripts/popup';

export interface EditorDialogOptions {
    title: string;
    /** 弹窗表单区（不含按钮行，由本函数追加）。 */
    content: JQuery<HTMLElement>;
    /** 保存回调：返回 false 或 reject 时不关闭弹窗；成功后自动关闭并 toastr。 */
    onSave: () => void | boolean | Promise<void | boolean>;
    /** 保存成功的提示文案（默认「已保存。」）。 */
    successMessage?: string;
    /** 取消/关闭回调（可选）。 */
    onCancel?: () => void;
    large?: boolean;
    wide?: boolean;
    /** 追加到按钮行末尾的额外按钮（如「保存并应用」）。每个 { label, icon, onClick, danger? }。 */
    extraActions?: Array<{
        label: string;
        icon?: string;
        title?: string;
        danger?: boolean;
        onClick: () => void | boolean | Promise<void | boolean>;
    }>;
}

/** 打开一个带「保存/取消」按钮行的编辑弹窗，统一 Popup 生命周期。 */
export function showEditorDialog(opts: EditorDialogOptions): Popup {
    const saveBtn = $('<button class="menu_button quicker-api__save-button" type="button"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></button>');
    const cancelBtn = $('<button class="menu_button" type="button"><span>取消</span></button>');
    const actions = $('<div class="st-router-editor-actions"></div>').append(saveBtn);

    if (opts.extraActions) {
        for (const extra of opts.extraActions) {
            const btn = $('<button class="menu_button" type="button"></button>')
                .attr('title', extra.title ?? extra.label)
                .toggleClass('quicker-api__delete-button', Boolean(extra.danger));
            if (extra.icon) btn.append($(`<i class="fa-solid ${extra.icon}"></i>`));
            btn.append($('<span>').text(extra.label));
            btn.on('click', async () => {
                const shouldClose = await runSaveAction(extra.onClick);
                if (shouldClose) popup.completeCancelled();
            });
            actions.append(btn);
        }
    }
    actions.append(cancelBtn);

    const body = $('<div class="st-router-editor"></div>');
    const titleRow = opts.title
        ? $('<div style="margin-bottom:8px;font-weight:600;font-size:14px"></div>').text(opts.title)
        : $('<div></div>');
    body.append(titleRow, opts.content, actions);

    const popup = new Popup(body, POPUP_TYPE.TEXT, '', {
        large: opts.large ?? false,
        wide: opts.wide ?? true,
        okButton: false,
        cancelButton: false,
    });

    saveBtn.on('click', async () => {
        const shouldClose = await runSaveAction(opts.onSave);
        if (shouldClose) {
            if (opts.successMessage) toastr.success(opts.successMessage);
            popup.completeCancelled();
        }
    });
    cancelBtn.on('click', () => {
        opts.onCancel?.();
        void popup.completeCancelled();
    });
    void popup.show();
    return popup;
}

async function runSaveAction(fn: () => void | boolean | Promise<void | boolean>): Promise<boolean> {
    try {
        const result = await fn();
        return result !== false;
    } catch (error) {
        console.error('[QuickerApi] Editor action failed:', error);
        toastr.error(error instanceof Error ? error.message : String(error));
        return false;
    }
}
