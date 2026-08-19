// 常量定义（来自 index.js 顶部的 FORMATS / DEFAULT_SETTINGS 等）
import type { FormatConfig, FormatName, QuickActionPlacement, RoutingSettings } from './types.js';

export const MODULE_NAME = 'quickerApi';
export const LEGACY_MODULE_NAME = 'customOpenAIProfiles';
export const SCHEMA_VERSION = 14;
export const EMPTY_SECRET_LABEL = 'Quicker Api · No key';

export const SUPPORTED_SOURCES = new Set([
    'custom',
    'claude',
    'makersuite',
]);

export const FORMATS: Record<FormatName, FormatConfig> = Object.freeze({
    openai: Object.freeze({
        label: 'OpenAI Compatible',
        source: 'custom',
        secretKey: 'custom',
        keyInput: '#api_key_custom',
        modelField: 'custom_model',
        modelInput: '#custom_model_id',
        endpointField: 'custom_url',
        endpointInput: '#custom_api_url_text',
    }),
    anthropic: Object.freeze({
        label: 'Anthropic',
        source: 'claude',
        secretKey: 'claude',
        keyInput: '#api_key_claude',
        modelField: 'claude_model',
        modelInput: '#model_claude_select',
        endpointField: 'reverse_proxy',
        endpointInput: '#openai_reverse_proxy',
    }),
    gemini: Object.freeze({
        label: 'Gemini',
        source: 'makersuite',
        secretKey: 'makersuite',
        keyInput: '#api_key_makersuite',
        modelField: 'google_model',
        modelInput: '#model_google_select',
        endpointField: 'reverse_proxy',
        endpointInput: '#openai_reverse_proxy',
    }),
});

export const FORMAT_NAMES: FormatName[] = ['openai', 'anthropic', 'gemini'];

export const QUICK_ACTION_PLACEMENTS: QuickActionPlacement[] = ['leftSendForm', 'rightSendForm', 'qrButtons', 'disabled'];

export const DEFAULT_ROUTING_SETTINGS: RoutingSettings = Object.freeze({
    enabled: false,
    stickyCount: 0,
    failThreshold: 3,
    cooldownSeconds: 300,
});

/** 规范化路由设置（载入时迁移用，与 DEFAULT_ROUTING_SETTINGS 语义一致）。
 *  兼容旧版 stickySeconds：若存在且 >0 则迁移为 stickyCount=1。 */
export function normalizeRoutingSettings(raw: unknown): RoutingSettings {
    const routing = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
    if (routing.stickyCount === undefined && routing.stickySeconds !== undefined) {
        routing.stickyCount = Number(routing.stickySeconds) > 0 ? 1 : 0;
    }
    return {
        enabled: Boolean(routing.enabled),
        stickyCount: Number.isFinite(Number(routing.stickyCount)) && Number(routing.stickyCount) >= 0
            ? Math.floor(Number(routing.stickyCount))
            : DEFAULT_ROUTING_SETTINGS.stickyCount,
        failThreshold: Number.isFinite(Number(routing.failThreshold)) && Number(routing.failThreshold) > 0
            ? Math.floor(Number(routing.failThreshold))
            : DEFAULT_ROUTING_SETTINGS.failThreshold,
        cooldownSeconds: Number.isFinite(Number(routing.cooldownSeconds)) && Number(routing.cooldownSeconds) > 0
            ? Math.floor(Number(routing.cooldownSeconds))
            : DEFAULT_ROUTING_SETTINGS.cooldownSeconds,
    };
}
