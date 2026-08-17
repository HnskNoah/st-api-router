// 拦截模式核心：在 ST 已组装好的请求数据上直接改连接字段。
// 不碰 DOM、不触发 reconnect/status 检查。
// custom/OpenAI 兼容 → source=custom + custom_url + secret_id（key 走 ST secrets）
// deepseek           → source=deepseek + reverse_proxy + proxy_password（key 随请求）
// 逻辑模型的 custom_include_body/exclude_body/headers 只对 custom 源生效（YAML 透传）。
// 纯函数，便于单元测试。

import type { GroupRouteUnit } from '../domain/group-routing.js';

export interface GenerationCustomParams {
    includeBody?: string;
    excludeBody?: string;
    includeHeaders?: string;
}

export function patchGenerateData(
    generateData: Record<string, any>,
    unit: GroupRouteUnit,
    customParams: GenerationCustomParams = {},
): void {
    const vendor = unit.vendor;
    const format = String(vendor?.format || 'custom');
    const endpoint = String(vendor?.endpoint || '').trim();
    const apiKey = String(unit.entry?.apiKey || '');
    const model = unit.realModel;

    if (format === 'deepseek') {
        generateData.chat_completion_source = 'deepseek';
        generateData.reverse_proxy = endpoint;
        generateData.proxy_password = apiKey;
    } else {
        generateData.chat_completion_source = 'custom';
        generateData.custom_url = endpoint;
        generateData.secret_id = String(unit.entry?.secretId || '');
        generateData.custom_include_body = String(customParams?.includeBody ?? '');
        generateData.custom_exclude_body = String(customParams?.excludeBody ?? '');
        generateData.custom_include_headers = String(customParams?.includeHeaders ?? '');
    }
    generateData.model = model;
}
