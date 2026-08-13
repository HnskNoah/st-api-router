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

export interface QuickerApiSettings {
    schemaVersion: number;
    profiles: Profile[];
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
