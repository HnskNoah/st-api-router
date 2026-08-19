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
    stickyCount: number;
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
    /** 路由到该逻辑模型时透传进 custom 源的 include body 参数（YAML，与 ST 原生语义一致）。可选，normalize 后为 ''。 */
    customIncludeBody?: string;
    /** 路由到该逻辑模型时透传进 custom 源的 exclude body 参数（YAML）。可选，normalize 后为 ''。 */
    customExcludeBody?: string;
    /** 路由到该逻辑模型时透传进 custom 源的附加请求头（YAML）。可选，normalize 后为 ''。 */
    customIncludeHeaders?: string;
}

/** 错误分类（从 toastr 错误消息推断，纯被动、无返回码）。 */
export type ModelFailureKind =
    | 'fatal'         // 不可恢复：模型不存在 / 余额不足 / 401/403 / 封禁 → 立即禁用该 realModel
    | 'rate_limited'  // 429 / rate limit → 只短冷却，不累计连续失败
    | 'temp'          // 超时 / 5xx / 连接失败 / 网络 → 计入连续失败，达阈值冷却
    | 'bad_request'   // 400 / 参数 / 格式错误 → 不是渠道故障，不处理
    | 'unknown';      // 无法归类 → 按 temp 稳妥处理

/** Group 条目：Vendor + Key。同一 Vendor 可在同一 Group 中挂多个条目；每个 Key 独立持有模型数据（部分模型只在特定 Key 上可获取）。 */
export interface GroupEntry {
    id: string;
    vendorId: string;
    apiKey: string;
    /** 该 Key 在本机 ST secrets 里的 secret id（custom Vendor 用 CUSTOM，deepseek 用 DEEPSEEK）；custom 源生成时透传为 secret_id。可选，normalize 后为 ''。 */
    secretId?: string;
    label: string;
    enabled: boolean;
    fetchedModels: string[];
    mappings: VendorModelMapping[];

    // ── 按 realModel 粒度的健康字段（仿旧 ProviderKey 的 circuits/failStreakByModel）──
    /** realModel -> 连续失败次数（运行时，跨会话载入即重置为 {}）。 */
    failStreakByModel?: Record<string, number>;
    /** realModel -> 熔断(冷却)截止时间戳（持久化，载入时按"已过期=可恢复"处理）。 */
    circuitsByModel?: Record<string, number>;
    /** realModel -> 错误分类（最近一次），诊断展示用（持久化）。 */
    lastErrorKindByModel?: Record<string, ModelFailureKind>;
    /** realModel -> 冷却倍数（指数退避：1→2→4→…，上限 cap）。成功或半开成功时归 1。 */
    cooldownMultiplierByModel?: Record<string, number>;
    /** 记录最近一次失败消息（截断），诊断展示用（持久化）。 */
    lastErrorByRealModel?: Record<string, string>;
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
