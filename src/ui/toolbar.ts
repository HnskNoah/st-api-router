// 工具栏 HTML 模板

import { FORMATS } from '../constants.js';

export function toolbarHtml(): string {
    const formatOptions = Object.entries(FORMATS).map(([value, config]) => `<option value="${value}">${config.label}</option>`).join('');
    return `
        <section id="quicker_api" class="quicker-api">
            <div class="quicker-api__title">
                <span><i class="fa-solid fa-bolt"></i> ST Api Router（旧版设置）</span>
                <span title="配置保存在 SillyTavern 用户设置中"><i class="fa-solid fa-database"></i></span>
            </div>
            <div class="quicker-api__field">
                <label for="quicker_api_profile_select">配置</label>
                <div class="quicker-api__row">
                    <select id="quicker_api_profile_select" class="text_pole" aria-label="API 配置"></select>
                    <button id="quicker_api_new" class="menu_button quicker-api__icon-button" type="button" title="新增 API 设置" aria-label="新增 API 设置"><i class="fa-solid fa-plus"></i></button>
                    <button id="quicker_api_save" class="menu_button quicker-api__icon-button quicker-api__save-button" type="button" title="保存 API 设置" aria-label="保存 API 设置"><i class="fa-solid fa-floppy-disk"></i></button>
                    <button id="quicker_api_rename" class="menu_button quicker-api__icon-button" type="button" title="重命名 API 设置" aria-label="重命名 API 设置"><i class="fa-solid fa-pen"></i></button>
                    <button id="quicker_api_copy" class="menu_button quicker-api__icon-button" type="button" title="复制 API 设置" aria-label="复制 API 设置"><i class="fa-solid fa-clone"></i></button>
                    <button id="quicker_api_import_native" class="menu_button quicker-api__text-button" type="button" title="批量迁移 SillyTavern 的 OpenAI、Reverse Proxy Presets 和 Connection Manager 配置"><i class="fa-solid fa-file-import"></i><span>导入原 OAI 设置</span></button>
                    <button id="quicker_api_delete" class="menu_button quicker-api__icon-button quicker-api__delete-button" type="button" title="删除 API 设置" aria-label="删除 API 设置"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            <div class="quicker-api__field">
                <label for="quicker_api_format">格式</label>
                <select id="quicker_api_format" class="text_pole" aria-label="API 格式">${formatOptions}</select>
            </div>
            <div class="quicker-api__field">
                <label for="quicker_api_url">URL</label>
                <input id="quicker_api_url" class="text_pole" type="url" autocomplete="off" placeholder="Custom 必填；Anthropic / Gemini 留空使用官方端点" />
            </div>
            <div class="quicker-api__field">
                <label for="quicker_api_key_input">Key / Password</label>
                <div class="quicker-api__row">
                    <input id="quicker_api_key_input" class="text_pole quicker-api__key-input" type="password" autocomplete="off" placeholder="无凭据" />
                    <button id="quicker_api_reveal_key" class="menu_button" type="button" title="显示或隐藏密码"><i class="fa-solid fa-eye-slash"></i></button>
                    <button id="quicker_api_copy_key" class="menu_button" type="button" title="复制密钥"><i class="fa-solid fa-copy"></i></button>
                    <div id="quicker_api_native_key_manager" class="menu_button fa-solid fa-key fa-fw manage-api-keys" title="Manage API keys" data-i18n="[title]Manage API keys" data-key="api_key_custom"></div>
                </div>
            </div>
            <div class="quicker-api__field">
                <label>模型</label>
                <div id="quicker_api_model_control" class="quicker-api__row"></div>
            </div>
            <div id="quicker_api_status" class="quicker-api__status"></div>
        </section>`;
}
