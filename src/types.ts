// 领域类型定义（忠实移植 index.js 的数据形状）

export type FormatName = 'openai' | 'anthropic' | 'gemini';

export interface FormatConfig {
    label: string;
    source: string;
    secretKey: string;
    keyInput: string;
    modelField: string;
    modelInput: string;
    endpointField: string;
    endpointInput: string;
}

export interface Profile {
    id: string;
    name: string;
    format: FormatName;
    endpoint: string;
    model: string;
    availableModels: string[];
    fetchedModels: string[];
    customized: boolean;
    fetchedFromEndpoint: string;
    includeBody: string;
    excludeBody: string;
    includeHeaders: string;
    secretId: string;
    proxyPreset: string;
    needsSecret: boolean;
    nativeImportFingerprint: string;
    updatedAt: string;
}

export interface QuickAction {
    id: string;
    name: string;
    preset: string;
    profileId: string;
    model: string;
    sequence: number;
}

export type QuickActionPlacement = 'leftSendForm' | 'rightSendForm' | 'qrButtons' | 'disabled';

// ── Provider 聚合路由领域类型（v11）──

export type ProviderFormat = 'custom' | 'custom-responses' | 'deepseek';

export interface ProviderKey {
    id: string;
    label: string;
    apiKey: string;
    fetchedModels: string[];
    rpm: number;
    weight: number;
    enabled: boolean;
    // ── 运行时状态（不持久化语义）──
    window: number[];                       // rpm 滑动窗口（熔断不影响 rpm 计数）
    circuits: Record<string, number>;       // model -> 熔断截止时间（熔断针对模型）
    failStreakByModel: Record<string, number>; // model -> 连续失败
    lastError: string;
}

export interface Provider {
    id: string;
    name: string;
    format: ProviderFormat;
    endpoint: string;
    keys: ProviderKey[];
    enabled: boolean;
    updatedAt: string;
}

export interface RoutingUnit {
    provider: Provider;
    key: ProviderKey;
}

/** 模型注册表条目：模型记录自己的承载供应商（provider/key）。 */
export interface ModelEntry {
    model: string;
    units: RoutingUnit[];
}

export interface RoutingSettings {
    enabled: boolean;
    stickySeconds: number;
    failThreshold: number;
    cooldownSeconds: number;
}

export interface LastPicked {
    unitId: string;
    until: number;
}

export interface RouteResult {
    unit: RoutingUnit | null;
    reasons: string[];
    nextLastPicked: LastPicked | null;
}

export interface QuickerApiSettings {
    schemaVersion: number;
    profiles: Profile[];
    providers: Provider[];
    routing: RoutingSettings;
    selectedProfileId: string | null;
    activeProfileId: string | null;
    emptySecretIds: Record<string, string>;
    presetBindings: Record<string, string>;
    migratedFromCustomOpenAIProfiles: boolean;
    blockedSecretKeys: Record<string, string>;
    quickActions: QuickAction[];
    quickActionPlacement: QuickActionPlacement;
}

export interface NativeSnapshot {
    source: string;
    custom_url: string;
    custom_model: string;
    custom_include_body: string;
    custom_exclude_body: string;
    custom_include_headers: string;
    reverse_proxy: string;
    claude_model: string;
    google_model: string;
    proxy_password: string;
}

export interface CredentialDescriptor {
    value: string;
    identity: string;
    exposureDenied: boolean;
}

export interface NativeImportCandidate {
    sourceRef: string;
    sourceLabel: string;
    name: string;
    format: FormatName;
    endpoint: string;
    model: string;
    proxyPreset: string;
    plainKey: string;
    sourceSecretKey: string;
    sourceSecretId: string;
    credential: CredentialDescriptor;
    identity: string;
    fingerprint: string;
}

export interface ResolvedImportCredential {
    secretId: string;
    proxyPreset: string;
    needsSecret: boolean;
    exposureDenied: boolean;
}

export interface SecretEntry {
    id: string;
    active?: boolean;
    name?: string;
    [key: string]: unknown;
}

export interface ModelFetchResult {
    models: string[];
    route: string;
    frontendError?: unknown;
}
