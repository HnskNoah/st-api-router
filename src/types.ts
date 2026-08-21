// 领域类型定义（Vendor / Group / QuickAction）

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

export interface QuickAction {
    id: string;
    name: string;
    preset: string;
    model: string;
    sequence: number;
}

export type QuickActionPlacement = 'leftSendForm' | 'rightSendForm' | 'qrButtons' | 'disabled';

export interface RoutingSettings {
    enabled: boolean;
    stickyCount: number;
    failThreshold: number;
    cooldownSeconds: number;
    /** 失败或空回复时的自动重试次数（换路由重生成）；0 = 关闭。 */
    autoRetryCount: number;
}

export type VendorFormat = 'custom' | 'deepseek';

/** Vendor 级模型映射：真实模型名归并到逻辑模型。 */
export interface VendorModelMapping {
    id: string;
    realModel: string;
    logicalModelId: string;
    /** 同一 Key 下该真实模型的相对渠道权重；归一化后默认 1。 */
    weight?: number;
}

/** 手动批量映射规则：对命中的真实模型名批量映射到目标逻辑模型。持久化，手动建立。 */
export interface MappingRule {
    id: string;
    /** 匹配真实模型名的正则（大小写不敏感）。 */
    pattern: string;
    /** 目标逻辑模型 id。 */
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

/** 错误分类（从 toastr 或生成正文推断，纯被动、无返回码）。 */
export type ModelFailureKind =
    | 'fatal'         // 不可恢复：模型不存在 / 余额不足 / 401/403 / 封禁 → 立即冷却该 realModel
    | 'rate_limited'  // 429 / rate limit → 只短冷却，不累计连续失败
    | 'temp'          // 超时 / 5xx / 连接失败 / 网络 → 计入连续失败，达阈值冷却
    | 'bad_request'   // 400 / 参数 / 格式错误 → 不是渠道故障，不处理
    | 'unknown';      // 无法归类 → 按 temp 稳妥处理

/** 生成错误与空回复的全局滑动窗口记录（按时间顺序，最多 200 条）。 */
export interface ModelObservationRecord {
    occurredAt: number;
    groupId: string;
    vendorId: string;
    entryId: string;
    realModel: string;
    logicalModelId: string;
    kind: ModelObservationKind;
    message: string;
}

/** 生成结果观测：空回复会记录，但不参与失败记账。 */
export type ModelObservationKind = ModelFailureKind | 'empty_response';


/** Group 条目：Vendor + Key。同一 Vendor 可在同一 Group 中挂多个条目；每个 Key 独立持有模型数据（部分模型只在特定 Key 上可获取）。 */
export interface GroupEntry {
    id: string;
    vendorId: string;
    apiKey: string;
    /** 该 Key 在本机 ST secrets 里的 secret id（custom Vendor 用 CUSTOM，deepseek 用 DEEPSEEK）；custom 源生成时透传为 secret_id。可选，normalize 后为 ''。 */
    secretId?: string;
    label: string;
    enabled: boolean;
    /** 同一 Vendor 内该 Key 的相对渠道权重；归一化后默认 1。 */
    weight?: number;
    fetchedModels: string[];
    mappings: VendorModelMapping[];

    // ── 按 realModel 粒度的健康字段 ──
    /** realModel -> 连续失败次数（运行时，跨会话载入即重置为 {}）。 */
    failStreakByModel?: Record<string, number>;
    /** realModel -> 熔断(冷却)截止时间戳（持久化，载入时按"已过期=可恢复"处理）。 */
    circuitsByModel?: Record<string, number>;
    /** realModel -> 最近一次错误或结果观测分类，诊断展示用（持久化）。 */
    lastErrorKindByModel?: Record<string, ModelObservationKind>;
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

export interface QuickerApiSettings {
    schemaVersion: number;
    vendors: Vendor[];
    logicalModels: LogicalModel[];
    groups: Group[];
    routing: RoutingSettings;
    activeGroupId: string | null;
    emptySecretIds: Record<string, string>;
    blockedSecretKeys: Record<string, string>;
    quickActions: QuickAction[];
    quickActionPlacement: QuickActionPlacement;
    /** 手动批量映射规则（持久化）。 */
    mappingRules: MappingRule[];
    /** 全局最近错误与空回复记录，最多保留 200 条。 */
    observationHistory: ModelObservationRecord[];
    /** 全局忽略的真实模型名清单（含手动忽略；特殊变体自动忽略，不持久化进此数组）。 */
    ignoredModels: string[];
}

export interface SecretEntry {
    id: string;
    active?: boolean;
    name?: string;
    [key: string]: unknown;
}

