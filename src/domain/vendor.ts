// Vendor / LogicalModel / Group 领域纯函数。
// 新路由模型与旧 Provider/Key 过渡实现共存：providers 保留作为一次性迁移来源。

import { normalizeModelList } from '../utils/model-list.js';
import { normalizeText, sanitizeName } from '../utils/text.js';
import { makeId } from '../utils/id.js';
import { normalizeProviderFormat } from './provider.js';
import type {
    Group,
    GroupEntry,
    LogicalModel,
    Provider,
    Vendor,
    VendorFormat,
    VendorMigrationResult,
    VendorModelMapping,
} from '../types.js';

export const VENDOR_RPM_DEFAULT = 3;
export const VENDOR_WEIGHT_DEFAULT = 1;

export function normalizeVendorModelMapping(raw: Record<string, any> | undefined): VendorModelMapping {
    return {
        id: normalizeText(raw?.id) || makeId('mapping'),
        realModel: normalizeText(raw?.realModel).slice(0, 500),
        logicalModelId: normalizeText(raw?.logicalModelId).slice(0, 200),
    };
}

function normalizeMappings(raw: unknown): VendorModelMapping[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.map(item => normalizeVendorModelMapping(item)).filter(mapping => {
        if (!mapping.realModel || !mapping.logicalModelId) return false;
        const key = `${mapping.realModel}::${mapping.logicalModelId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function normalizeVendor(raw: Record<string, any> | undefined): Vendor {
    const format: VendorFormat = normalizeProviderFormat(raw?.format);
    const fetchedModels = normalizeModelList(raw?.fetchedModels);
    return {
        id: normalizeText(raw?.id) || makeId('vendor'),
        name: sanitizeName(raw?.name) || 'Vendor',
        format,
        endpoint: normalizeText(raw?.endpoint).slice(0, 2048),
        rpm: Number.isFinite(Number(raw?.rpm)) && Number(raw?.rpm) >= 0
            ? Math.floor(Number(raw?.rpm))
            : VENDOR_RPM_DEFAULT,
        maxContext: Number.isFinite(Number(raw?.maxContext)) && Number(raw?.maxContext) >= 0
            ? Math.floor(Number(raw?.maxContext))
            : 0,
        weight: Number.isFinite(Number(raw?.weight)) && Number(raw?.weight) > 0
            ? Number(raw?.weight)
            : VENDOR_WEIGHT_DEFAULT,
        enabled: raw?.enabled === undefined ? true : Boolean(raw.enabled),
        disabledReason: String(raw?.disabledReason ?? '').slice(0, 500),
        fetchedModels,
        mappings: normalizeMappings(raw?.mappings),
        window: Array.isArray(raw?.window) ? raw.window.filter((value: unknown) => typeof value === 'number') : [],
        failStreak: Number.isFinite(Number(raw?.failStreak)) && Number(raw?.failStreak) >= 0
            ? Math.floor(Number(raw?.failStreak))
            : 0,
        successes: Number.isFinite(Number(raw?.successes)) && Number(raw?.successes) >= 0
            ? Math.floor(Number(raw?.successes))
            : 0,
        failures: Number.isFinite(Number(raw?.failures)) && Number(raw?.failures) >= 0
            ? Math.floor(Number(raw?.failures))
            : 0,
        lastError: String(raw?.lastError ?? '').slice(0, 500),
        updatedAt: String(raw?.updatedAt ?? ''),
    };
}

export function normalizeVendors(raw: unknown): Vendor[] {
    if (!Array.isArray(raw)) return [];
    return raw.map(item => normalizeVendor(item));
}

export function normalizeLogicalModel(raw: Record<string, any> | undefined): LogicalModel {
    return {
        id: normalizeText(raw?.id) || makeId('logical'),
        name: sanitizeName(raw?.name) || 'Logical Model',
        matchPattern: String(raw?.matchPattern ?? '').slice(0, 500),
    };
}

/** 按 matchPattern 正则匹配真实模型名；返回第一个命中（无正则的模型不参与）。非法正则视为未命中。 */
export function findLogicalModelByPattern(logicalModels: LogicalModel[], realModel: string): LogicalModel | null {
    for (const model of logicalModels) {
        const pattern = String(model?.matchPattern || '').trim();
        if (!pattern) continue;
        try {
            if (new RegExp(pattern).test(realModel)) return model;
        } catch {
            // 非法正则跳过
        }
    }
    return null;
}

/** 拉取模型后的归类：正则命中 → 名称精确匹配 → 核心模型名合并（剥渠道/变体前缀）→ 新建（用核心名）。返回归属的逻辑模型。 */
export function assignRealModel(logicalModels: LogicalModel[], realModel: string): LogicalModel {
    const byPattern = findLogicalModelByPattern(logicalModels, realModel);
    if (byPattern) return byPattern;
    const byName = logicalModels.find(model => model.name === realModel);
    if (byName) return byName;
    const canonical = canonicalModelName(realModel);
    if (canonical && canonical !== realModel) {
        const byCanonical = logicalModels.find(model => model.name === canonical);
        if (byCanonical) return byCanonical;
    }
    const model = normalizeLogicalModel({ name: canonical || realModel });
    logicalModels.push(model);
    return model;
}

/** 拉取后收敛映射：只保留仍在新模型列表中的真实模型映射（以最新拉取结果为权威），返回移除条数。 */
export function reconcileVendorMappings(vendor: Vendor, models: string[]): number {
    const kept = new Set(models);
    const before = vendor.mappings.length;
    vendor.mappings = vendor.mappings.filter(mapping => kept.has(mapping.realModel));
    return before - vendor.mappings.length;
}

/** 回收孤儿逻辑模型：没有任何 Vendor 映射引用、且未配置自动归类正则的逻辑模型；返回被回收的 id 列表。 */
export function pruneOrphanLogicalModels(logicalModels: LogicalModel[], vendors: Vendor[]): string[] {
    const referenced = new Set<string>();
    for (const vendor of vendors) {
        for (const mapping of vendor.mappings) referenced.add(mapping.logicalModelId);
    }
    const removed: string[] = [];
    for (let index = logicalModels.length - 1; index >= 0; index--) {
        const model = logicalModels[index];
        if (!referenced.has(model.id) && !String(model.matchPattern || '').trim()) {
            removed.push(model.id);
            logicalModels.splice(index, 1);
        }
    }
    return removed;
}

/** 未归类模型：所有 Vendor 已拉取但无任何映射的真实模型（跨 Vendor 去重，排除特殊变体）。 */
export function findUnmappedModels(vendors: Vendor[]): string[] {
    const mapped = new Set<string>();
    for (const vendor of vendors) {
        for (const mapping of vendor.mappings) mapped.add(mapping.realModel);
    }
    const result = new Set<string>();
    for (const vendor of vendors) {
        for (const raw of vendor.fetchedModels) {
            const name = String(raw || '').trim();
            if (!name || mapped.has(name) || isSpecialVariant(name)) continue;
            result.add(name);
        }
    }
    return [...result];
}

/** 手动补选：给真实模型指定逻辑模型，对所有包含该模型的 Vendor 生效（已存在则更新）。返回受影响的 Vendor 数。 */
export function assignModelToLogical(vendors: Vendor[], realModel: string, logicalModelId: string): number {
    let touched = 0;
    for (const vendor of vendors) {
        if (!vendor.fetchedModels.includes(realModel)) continue;
        const existing = vendor.mappings.find(mapping => mapping.realModel === realModel);
        if (existing) {
            existing.logicalModelId = logicalModelId;
        } else {
            vendor.mappings.push({ id: makeId('mapping'), realModel, logicalModelId });
        }
        touched++;
    }
    return touched;
}

/** 模型列表导出（txt）：所有 Vendor 已拉取真实模型名，每行一个，去重并按名称排序。刻意不含任何密钥字段。 */
export function buildModelListText(vendors: Vendor[]): string {
    const names = new Set<string>();
    for (const vendor of vendors) {
        for (const model of vendor.fetchedModels) {
            const trimmed = String(model || '').trim();
            if (trimmed) names.add(trimmed);
        }
    }
    return [...names].sort((a, b) => a < b ? -1 : a > b ? 1 : 0).join('\n');
}

const SPECIAL_VARIANT_RE = /(?:search|thinking|image|cache)/i;

/** 特殊变体判断：模型名含 search/thinking/image/cache（大小写不敏感）视为非对话用途，跳过。 */
export function isSpecialVariant(name: string): boolean {
    return SPECIAL_VARIANT_RE.test(String(name || '').trim());
}

/** 提取核心模型名：剥离渠道/变体前缀（[xx]、gcli-、假流式-、xxx/），同一核心模型的不同变体归并。 */
export function canonicalModelName(raw: string): string {
    let name = String(raw || '').trim();
    name = name.replace(/^\[[^\]]*\]/, '');
    const slashIndex = name.lastIndexOf('/');
    if (slashIndex >= 0) name = name.slice(slashIndex + 1);
    name = name.replace(/^gcli-/, '').replace(/^假流式-/, '');
    return name;
}

/** 从已拉取模型批量创建逻辑模型：每个核心模型独立创建一个（渠道/假流式变体合并），跳过 search/thinking/image 变体。 */
export function buildLogicalModelsFromFetched(
    models: string[],
    logicalModels: LogicalModel[],
): { created: LogicalModel[]; skipped: string[] } {
    const existingNames = new Set(logicalModels.map(model => model.name));
    const seen = new Set<string>();
    const created: LogicalModel[] = [];
    const skipped: string[] = [];
    for (const raw of models) {
        const name = String(raw || '').trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        if (isSpecialVariant(name)) {
            skipped.push(name);
            continue;
        }
        const canonical = canonicalModelName(name);
        if (existingNames.has(canonical)) continue;
        const model = normalizeLogicalModel({ name: canonical });
        logicalModels.push(model);
        existingNames.add(canonical);
        created.push(model);
    }
    return { created, skipped };
}

export function normalizeLogicalModels(raw: unknown): LogicalModel[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.map(item => normalizeLogicalModel(item)).filter(model => {
        if (seen.has(model.id)) return false;
        seen.add(model.id);
        return true;
    });
}

export function normalizeGroupEntry(raw: Record<string, any> | undefined): GroupEntry {
    return {
        id: normalizeText(raw?.id) || makeId('group-entry'),
        vendorId: normalizeText(raw?.vendorId).slice(0, 200),
        apiKey: normalizeText(raw?.apiKey).slice(0, 2048),
        label: sanitizeName(raw?.label) || 'Key',
        enabled: raw?.enabled === undefined ? true : Boolean(raw.enabled),
    };
}

function normalizeEntries(raw: unknown): GroupEntry[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.map(item => normalizeGroupEntry(item)).filter(entry => {
        if (!entry.vendorId) return false;
        if (seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
    });
}

export function normalizeGroup(raw: Record<string, any> | undefined): Group {
    return {
        id: normalizeText(raw?.id) || makeId('group'),
        name: sanitizeName(raw?.name) || 'Group',
        enabled: raw?.enabled === undefined ? true : Boolean(raw.enabled),
        currentLogicalModelId: normalizeText(raw?.currentLogicalModelId).slice(0, 200),
        entries: normalizeEntries(raw?.entries),
    };
}

export function normalizeGroups(raw: unknown): Group[] {
    if (!Array.isArray(raw)) return [];
    return raw.map(item => normalizeGroup(item));
}

/** 载入时重置 Vendor 运行时状态；成功率统计保留，便于跨会话累积。 */
export function resetVendorRuntimeState(vendors: Vendor[]): void {
    for (const vendor of vendors) {
        vendor.window = [];
        vendor.failStreak = 0;
        vendor.lastError = '';
    }
}

/** 成功率加权：无历史时用基础权重；全成功提升 50%，全失败保留 50%。 */
export function vendorEffectiveWeight(vendor: Vendor): number {
    const weight = Number(vendor?.weight) > 0 ? Number(vendor.weight) : VENDOR_WEIGHT_DEFAULT;
    const total = (Number(vendor?.successes) || 0) + (Number(vendor?.failures) || 0);
    if (total <= 0) return weight;
    const successRate = (Number(vendor?.successes) || 0) / total;
    return weight * (0.5 + successRate);
}

export function recordVendorSuccess(vendor: Vendor): void {
    if (!vendor) return;
    vendor.successes = (Number(vendor.successes) || 0) + 1;
    vendor.failStreak = 0;
    vendor.lastError = '';
}

/** 记录 Vendor 级失败；达到阈值自动禁用整个 Vendor，返回是否刚被禁用。 */
export function recordVendorFailure(vendor: Vendor, error: string, threshold: number): boolean {
    if (!vendor) return false;
    vendor.failures = (Number(vendor.failures) || 0) + 1;
    vendor.failStreak = (Number(vendor.failStreak) || 0) + 1;
    vendor.lastError = String(error ?? '').slice(0, 500);
    if (vendor.failStreak >= Math.max(1, Math.floor(Number(threshold) || 1))) {
        vendor.enabled = false;
        vendor.disabledReason = `连续失败 ${vendor.failStreak} 次已自动禁用`;
        return true;
    }
    return false;
}

function ensureLogicalModelId(models: Map<string, LogicalModel>, name: string, id: string): string {
    const existing = models.get(name);
    if (existing) return existing.id;
    const model: LogicalModel = { id: id || makeId('logical'), name, matchPattern: '' };
    models.set(name, model);
    return model.id;
}

/** 旧 Provider/Key 过渡实现 → Vendor / LogicalModel / Group 迁移。 */
export function migrateProvidersToVendorModel(providers: Provider[] | undefined): VendorMigrationResult {
    const logicalModels = new Map<string, LogicalModel>();
    const vendors: Vendor[] = [];
    const entries: GroupEntry[] = [];

    for (const provider of providers || []) {
        const vendorMappings: VendorModelMapping[] = [];
        const fetched = new Set<string>();
        for (const key of provider?.keys || []) {
            for (const model of key?.fetchedModels || []) {
                if (!model) continue;
                fetched.add(model);
                const logicalId = ensureLogicalModelId(logicalModels, model, `lm-${model}`);
                vendorMappings.push({ id: makeId('mapping'), realModel: model, logicalModelId: logicalId });
            }
        }
        const firstKey = provider?.keys?.[0];
        vendors.push(normalizeVendor({
            id: provider.id,
            name: provider.name,
            format: provider.format,
            endpoint: provider.endpoint,
            enabled: provider.enabled,
            rpm: firstKey?.rpm ?? VENDOR_RPM_DEFAULT,
            weight: firstKey?.weight ?? VENDOR_WEIGHT_DEFAULT,
            fetchedModels: [...fetched],
            mappings: vendorMappings,
            updatedAt: provider.updatedAt,
        }));
        for (const key of provider?.keys || []) {
            entries.push({
                id: makeId('group-entry'),
                vendorId: provider.id,
                apiKey: key.apiKey,
                label: key.label || 'Key',
                enabled: key.enabled,
            });
        }
    }

    const firstLogical = [...logicalModels.values()][0];
    const groups: Group[] = entries.length > 0
        ? [normalizeGroup({
            name: '默认分组',
            enabled: true,
            currentLogicalModelId: firstLogical?.id || '',
            entries,
        })]
        : [];

    return {
        vendors,
        logicalModels: [...logicalModels.values()],
        groups,
    };
}
