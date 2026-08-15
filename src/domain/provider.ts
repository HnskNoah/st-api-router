// Provider / Key 存储：供应商（网站）+ 多个 Key（各自 apiKey/RPM/权重/模型清单）。
// 路由粒度为 Key；熔断粒度为（Key × 模型），RPM 窗口独立于熔断。
// 旧单 key 形状（provider 上平铺 apiKey/rpm/weight/fetchedModels）自动迁移进 keys[0]。
// 自包含纯模块，可独立测试。

import { normalizeModelList } from '../utils/model-list.js';
import { normalizeText, sanitizeName } from '../utils/text.js';
import { makeId } from '../utils/id.js';
import type { Provider, ProviderFormat, ProviderKey } from '../types.js';

export const PROVIDER_RPM_DEFAULT = 3;
export const PROVIDER_WEIGHT_DEFAULT = 1;
export const PROVIDER_FORMATS: ProviderFormat[] = ['custom', 'deepseek'];

export function normalizeProviderFormat(value: unknown): ProviderFormat {
    const v = String(value ?? '').trim();
    return (PROVIDER_FORMATS as string[]).includes(v) ? (v as ProviderFormat) : 'custom';
}

/** 规范化单个 Key。运行时状态（window/circuits/failStreakByModel/lastError）保留 raw 现值（编辑器保存不丢熔断/窗口），
 * 载入时的重置由 initializeSettings 统一执行。 */
export function normalizeKey(raw: Record<string, any> | undefined): ProviderKey {
    const rawWindow = raw?.window;
    const rawCircuits = raw?.circuits;
    const rawStreak = raw?.failStreakByModel;
    return {
        id: normalizeText(raw?.id) || makeId('key'),
        label: normalizeText(raw?.label).slice(0, 120) || 'Key',
        apiKey: normalizeText(raw?.apiKey).slice(0, 2048),
        fetchedModels: normalizeModelList(raw?.fetchedModels),
        rpm: Number.isFinite(Number(raw?.rpm)) && Number(raw?.rpm) >= 0 ? Math.floor(Number(raw?.rpm)) : PROVIDER_RPM_DEFAULT,
        weight: Number.isFinite(Number(raw?.weight)) && Number(raw?.weight) >= 0 ? Number(raw?.weight) : PROVIDER_WEIGHT_DEFAULT,
        enabled: raw?.enabled === undefined ? true : Boolean(raw.enabled),
        // ── 运行时状态：保留现值（缺失才给默认）──
        window: Array.isArray(rawWindow) ? rawWindow : [],
        circuits: rawCircuits && typeof rawCircuits === 'object' ? rawCircuits : {},
        failStreakByModel: rawStreak && typeof rawStreak === 'object' ? rawStreak : {},
        lastError: String(raw?.lastError ?? ''),
    };
}

/** 规范化单个 Provider。旧平铺形状（无 keys 数组）自动迁移为单 key。 */
export function normalizeProvider(raw: Record<string, any> | undefined): Provider {
    const rawKeys = raw?.keys;
    const keys: ProviderKey[] = Array.isArray(rawKeys)
        ? rawKeys.map(item => normalizeKey(item))
        : [normalizeKey({
            id: raw?.keyId,
            label: raw?.label,
            apiKey: raw?.apiKey,
            fetchedModels: raw?.fetchedModels,
            rpm: raw?.rpm,
            weight: raw?.weight,
            enabled: raw?.keyEnabled,
        })];
    return {
        id: normalizeText(raw?.id) || makeId('provider'),
        name: sanitizeName(raw?.name) || 'Provider',
        format: normalizeProviderFormat(raw?.format),
        endpoint: String(raw?.endpoint ?? '').trim().slice(0, 2048),
        keys,
        enabled: raw?.enabled === undefined ? true : Boolean(raw.enabled),
        updatedAt: String(raw?.updatedAt ?? ''),
    };
}

export function normalizeProviders(raw: unknown): Provider[] {
    if (!Array.isArray(raw)) return [];
    return raw.map(item => normalizeProvider(item));
}

/** 载入时重置运行时状态（窗口/熔断/失败计数不跨会话）。由 initializeSettings 统一调用。 */
export function resetRoutingRuntimeState(providers: Provider[]): void {
    for (const provider of providers) {
        for (const key of provider.keys) {
            key.window = [];
            key.circuits = {};
            key.failStreakByModel = {};
            key.lastError = '';
        }
    }
}

/**
 * 旧 API Profile → Provider（迁移 v11）：
 * 保留 profile.id；format 统一 custom（旧 anthropic/gemini 的 reverse_proxy 值作 endpoint）；
 * profile.model 与 availableModels 记入唯一 key 的 fetchedModels（只记录，作为初始候选清单）。
 */
export function providerFromProfile(profile: Record<string, any> | undefined): Provider {
    return normalizeProvider({
        id: profile?.id,
        name: profile?.name,
        format: 'custom',
        endpoint: profile?.format === 'openai'
            ? profile?.endpoint
            : (profile?.proxyPreset?.url || profile?.endpoint || ''),
        keys: [{
            label: profile?.name || 'Key',
            fetchedModels: [profile?.model, ...(Array.isArray(profile?.availableModels) ? profile.availableModels : [])],
        }],
        updatedAt: profile?.updatedAt,
    });
}
