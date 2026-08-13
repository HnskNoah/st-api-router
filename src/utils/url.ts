// URL 构造工具

export function buildModelsEndpoint(endpoint: string): string {
    const url = new URL(endpoint);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/(chat\/completions|responses)\/?$/i, '').replace(/\/$/, '') + '/models';
    return url.toString();
}
