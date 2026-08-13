// 带超时与 AbortController 管理的 fetch 封装

import { activeFetchControllers } from './state.js';

export type ConsumeResponse = (response: Response) => Promise<unknown> | unknown;

export async function fetchWithTimeout(
    resource: RequestInfo | URL,
    options: RequestInit = {},
    timeout = 15000,
    consumeResponse: ConsumeResponse | null = null,
): Promise<Response | unknown> {
    const controller = new AbortController();
    activeFetchControllers.add(controller);
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(resource, { ...options, signal: controller.signal });
        return consumeResponse ? await consumeResponse(response) : response;
    } finally {
        clearTimeout(timeoutId);
        activeFetchControllers.delete(controller);
    }
}

export async function fetchJsonWithTimeout(
    resource: RequestInfo | URL,
    options: RequestInit = {},
    timeout = 15000,
): Promise<{ response: Response; data: any }> {
    return await fetchWithTimeout(resource, options, timeout, async response => ({
        response,
        data: response.ok ? await response.json() : null,
    })) as { response: Response; data: any };
}
