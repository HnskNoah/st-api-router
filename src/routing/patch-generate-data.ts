// 拦截模式核心：在 ST 已组装好的请求数据上直接改连接字段。
// 不碰 DOM、不触发 reconnect/status 检查、不经过 secrets 系统（不产生新密钥文件条目）。
// 纯函数，便于单元测试。

import type { GroupRouteUnit } from '../domain/group-routing.js';

/**
 * 把路由单元写进 ST 的 generateData：
 *   custom/OpenAI 兼容 → source=openai + reverse_proxy + proxy_password + model
 *   deepseek           → source=deepseek + reverse_proxy + proxy_password + model
 * 密钥走 proxy_password，ST 后端在 reverse_proxy 模式下直接用该字段，不查 secrets。
 */
export function patchGenerateData(generateData: Record<string, any>, unit: GroupRouteUnit): void {
    const vendor = unit.vendor;
    const format = String(vendor?.format || 'custom');
    const endpoint = String(vendor?.endpoint || '').trim();
    const apiKey = String(unit.entry?.apiKey || '');
    const model = unit.realModel;

    if (format === 'deepseek') {
        generateData.chat_completion_source = 'deepseek';
    } else {
        // custom / OpenAI 兼容 → 走 openai reverse_proxy 模式
        generateData.chat_completion_source = 'openai';
    }
    generateData.reverse_proxy = endpoint;
    generateData.proxy_password = apiKey;
    generateData.model = model;
}
