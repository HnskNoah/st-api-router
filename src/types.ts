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
    model: string;
    sequence: number;
}

export type QuickActionPlacement = 'leftSendForm' | 'rightSendForm' | 'qrButtons' | 'disabled';

// ── Provider 聚合路由领域类型（v11）──

export type ProviderFormat = 'custom' | 'deepseek';

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

export type VendorFormat = ProviderFormat;

/** Vendor 级模型映射：真实模型名归并到逻辑模型。 */
export interface VendorModelMapping {
    id: string;
    realModel: string;
    logicalModelId: string;
}

/** Vendor（模型商）：全局限流、健康状态、RPM/上下文限制都挂在 Vendor 级；模型数据按 Key 挂在 GroupEntry。 */
export interface Vendor {
    id: string;
    name: string;
    format: VendorFormat;
    endpoint: string;
    rpm: number;
    maxContext: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    weight: number;
    enabled: boolean;
    disabledReason: string;
    window: number[];
    failStreak: number;
    successes: number;
    failures: number;
    lastError: string;
    updatedAt: string;
}

export interface LogicalModel {
    id: string;
    name: string;
    /** 拉取模型时的自动归类正则（真实模型名命中即归入该逻辑模型）；空 = 不参与正则匹配。 */
    matchPattern: string;
}

/** Group 条目：Vendor + Key。同一 Vendor 可在同一 Group 中挂多个条目；每个 Key 独立持有模型数据（部分模型只在特定 Key 上可获取）。 */
export interface GroupEntry {
    id: string;
    vendorId: string;
    apiKey: string;
    label: string;
    enabled: boolean;
    fetchedModels: string[];
    mappings: VendorModelMapping[];
}

/** Group（功能分组）：全局使用环境，持有当前逻辑模型和 Vendor + Key 条目。 */
export interface Group {
    id: string;
    name: string;
    enabled: boolean;
    currentLogicalModelId: string;
    entries: GroupEntry[];
}

export interface VendorMigrationResult {
    vendors: Vendor[];
    logicalModels: LogicalModel[];
    groups: Group[];
}

export interface QuickerApiSettings {
    schemaVersion: number;
    profiles: Profile[];
    providers: Provider[];
    vendors: Vendor[];
    logicalModels: LogicalModel[];
    groups: Group[];
    routing: RoutingSettings;
    selectedProfileId: string | null;
    activeProfileId: string | null;
    activeGroupId: string | null;
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
