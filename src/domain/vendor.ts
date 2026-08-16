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
        maxInputTokens: Number.isFinite(Number(raw?.maxInputTokens)) && Number(raw?.maxInputTokens) >= 0
            ? Math.floor(Number(raw?.maxInputTokens))
            : 0,
        maxOutputTokens: Number.isFinite(Number(raw?.maxOutputTokens)) && Number(raw?.maxOutputTokens) >= 0
            ? Math.floor(Number(raw?.maxOutputTokens))
            : 0,
        weight: Number.isFinite(Number(raw?.weight)) && Number(raw?.weight) > 0
            ? Number(raw?.weight)
            : VENDOR_WEIGHT_DEFAULT,
        enabled: raw?.enabled === undefined ? true : Boolean(raw.enabled),
        disabledReason: String(raw?.disabledReason ?? '').slice(0, 500),
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

/** 按名称大小写不敏感查找逻辑模型（deepseek 与 DeepSeek 视为同名）。 */
function findLogicalByNameCI(logicalModels: LogicalModel[], name: string): LogicalModel | null {
    const value = String(name || '').trim().toLowerCase();
    if (!value) return null;
    return logicalModels.find(model => String(model?.name || '').trim().toLowerCase() === value) || null;
}

/** 拉取模型后的归类：正则命中 → 名称精确匹配（大小写不敏感）→ 核心模型名合并（剥渠道/变体前缀，大小写不敏感）→ 新建（用核心名）。返回归属的逻辑模型。 */
export function assignRealModel(logicalModels: LogicalModel[], realModel: string): LogicalModel {
    const byPattern = findLogicalModelByPattern(logicalModels, realModel);
    if (byPattern) return byPattern;
    const byName = findLogicalByNameCI(logicalModels, realModel);
    if (byName) return byName;
    const canonical = canonicalModelName(realModel);
    if (canonical && canonical !== realModel) {
        const byCanonical = findLogicalByNameCI(logicalModels, canonical);
        if (byCanonical) return byCanonical;
    }
    const model = normalizeLogicalModel({ name: canonical || realModel });
    logicalModels.push(model);
    return model;
}

/** 拉取后收敛 Key 级映射：只保留仍在新模型列表中的真实模型映射（以最新拉取结果为权威），返回移除条数。 */
export function reconcileEntryMappings(entry: GroupEntry, models: string[]): number {
    const kept = new Set(models);
    const before = entry.mappings.length;
    entry.mappings = entry.mappings.filter(mapping => kept.has(mapping.realModel));
    return before - entry.mappings.length;
}

/** 回收孤儿逻辑模型：没有任何 Key 映射引用、且未配置自动归类正则的逻辑模型；返回被回收的 id 列表。 */
export function pruneOrphanLogicalModels(logicalModels: LogicalModel[], groups: Group[]): string[] {
    const referenced = new Set<string>();
    for (const entry of allGroupEntries(groups)) {
        for (const mapping of entry.mappings) referenced.add(mapping.logicalModelId);
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

/** 重置模型数据：删光全部逻辑模型、所有 Key 的映射与已拉取模型列表，分组当前逻辑模型指针置空。
 *  供"重置模型数据"按钮使用（重置后由前端重新拉取重建）。返回删除的统计。 */
export function resetModelData(
    logicalModels: LogicalModel[],
    groups: Group[],
): { removedLogicalModels: number; removedMappings: number } {
    const removedLogicalModels = logicalModels.length;
    let removedMappings = 0;
    logicalModels.splice(0, logicalModels.length);
    for (const entry of allGroupEntries(groups)) {
        removedMappings += entry.mappings.length;
        entry.mappings = [];
        entry.fetchedModels = [];
    }
    for (const group of groups) {
        group.currentLogicalModelId = '';
    }
    return { removedLogicalModels, removedMappings };
}

/** 聚合所有 Group 的 Key 条目（模型数据按 Key 级存放）。 */
export function allGroupEntries(groups: Group[]): GroupEntry[] {
    const entries: GroupEntry[] = [];
    for (const group of groups || []) {
        for (const entry of group?.entries || []) entries.push(entry);
    }
    return entries;
}

/** 导入配置合并：vendors / logicalModels / groups 按 id 更新或新增，不删除现有数据；
 *  group 的 entries 按 entry.id 合并。返回合并后的新快照（不修改入参）。 */
export function mergeImportedRoutingConfig(
    current: { vendors: Vendor[]; logicalModels: LogicalModel[]; groups: Group[] },
    imported: { vendors: Vendor[]; logicalModels: LogicalModel[]; groups: Group[] },
): { vendors: Vendor[]; logicalModels: LogicalModel[]; groups: Group[] } {
    const vendors = current.vendors.map(vendor => normalizeVendor(structuredClone(vendor)));
    const logicalModels = current.logicalModels.map(model => normalizeLogicalModel(structuredClone(model)));
    const groups = current.groups.map(group => normalizeGroup(structuredClone(group)));

    const vendorById = new Map(vendors.map(vendor => [vendor.id, vendor]));
    for (const raw of imported.vendors || []) {
        const vendor = normalizeVendor(structuredClone(raw));
        if (!vendor.id) continue;
        const existing = vendorById.get(vendor.id);
        if (existing) Object.assign(existing, vendor);
        else {
            vendorById.set(vendor.id, vendor);
            vendors.push(vendor);
        }
    }

    const logicalById = new Map(logicalModels.map(model => [model.id, model]));
    for (const raw of imported.logicalModels || []) {
        const model = normalizeLogicalModel(structuredClone(raw));
        if (!model.id) continue;
        const existing = logicalById.get(model.id);
        if (existing) Object.assign(existing, model);
        else {
            logicalById.set(model.id, model);
            logicalModels.push(model);
        }
    }

    const groupById = new Map(groups.map(group => [group.id, group]));
    for (const rawGroup of imported.groups || []) {
        const group = normalizeGroup(structuredClone(rawGroup));
        if (!group.id) continue;
        const existing = groupById.get(group.id);
        if (existing) {
            const entryById = new Map(existing.entries.map(entry => [entry.id, entry]));
            for (const entry of group.entries) {
                const currentEntry = entryById.get(entry.id);
                if (currentEntry) Object.assign(currentEntry, entry);
                else {
                    entryById.set(entry.id, entry);
                    existing.entries.push(entry);
                }
            }
            existing.name = group.name;
            existing.enabled = group.enabled;
            existing.currentLogicalModelId = group.currentLogicalModelId;
        } else {
            groupById.set(group.id, group);
            groups.push(group);
        }
    }

    return { vendors, logicalModels, groups };
}

/** 已归类真实模型：所有 Key 已有映射的真实模型（跨 Key 去重，按名称排序，带归属逻辑模型 id）。 */
export function mappedRealModels(groups: Group[]): { realModel: string; logicalModelId: string }[] {
    const byName = new Map<string, string>();
    for (const entry of allGroupEntries(groups)) {
        for (const mapping of entry.mappings) {
            if (byName.has(mapping.realModel)) continue;
            if (!mapping.logicalModelId) continue;
            byName.set(mapping.realModel, mapping.logicalModelId);
        }
    }
    return [...byName.entries()]
        .map(([realModel, logicalModelId]) => ({ realModel, logicalModelId }))
        .sort((a, b) => a.realModel < b.realModel ? -1 : a.realModel > b.realModel ? 1 : 0);
}

/** 未归类模型：所有 Key 已拉取但无任何映射的真实模型（跨 Key 去重，排除特殊变体）。 */
export function findUnmappedModels(groups: Group[]): string[] {
    const mapped = new Set<string>();
    for (const entry of allGroupEntries(groups)) {
        for (const mapping of entry.mappings) mapped.add(mapping.realModel);
    }
    const result = new Set<string>();
    for (const entry of allGroupEntries(groups)) {
        for (const raw of entry.fetchedModels) {
            const name = String(raw || '').trim();
            if (!name || mapped.has(name) || isSpecialVariant(name)) continue;
            result.add(name);
        }
    }
    return [...result];
}

/** 手动补选：给真实模型指定逻辑模型，对所有包含该模型的 Key 生效（已存在则更新）。返回受影响的 Key 数。 */
export function assignModelToLogical(groups: Group[], realModel: string, logicalModelId: string): number {
    let touched = 0;
    for (const entry of allGroupEntries(groups)) {
        if (!entry.fetchedModels.includes(realModel)) continue;
        const existing = entry.mappings.find(mapping => mapping.realModel === realModel);
        if (existing) {
            existing.logicalModelId = logicalModelId;
        } else {
            entry.mappings.push({ id: makeId('mapping'), realModel, logicalModelId });
        }
        touched++;
    }
    return touched;
}

/** 删除真实模型的全部映射（进入未归类）。返回移除的映射条数。 */
export function unmapRealModel(groups: Group[], realModel: string): number {
    let removed = 0;
    for (const entry of allGroupEntries(groups)) {
        const before = entry.mappings.length;
        entry.mappings = entry.mappings.filter(mapping => mapping.realModel !== realModel);
        removed += before - entry.mappings.length;
    }
    return removed;
}

/** 合并逻辑模型：把源逻辑模型名下的全部真实模型映射到目标逻辑模型，删除源逻辑模型，并修正分组当前模型指针。
 *  返回移动的映射数与删除的源逻辑模型 id。 */
export function mergeLogicalModels(
    logicalModels: LogicalModel[],
    groups: Group[],
    sourceId: string,
    targetId: string,
): { movedMappings: number; removedLogicalModelId: string | null } {
    if (!sourceId || !targetId || sourceId === targetId) {
        return { movedMappings: 0, removedLogicalModelId: null };
    }
    if (!logicalModels.some(model => model.id === sourceId) || !logicalModels.some(model => model.id === targetId)) {
        return { movedMappings: 0, removedLogicalModelId: null };
    }

    let movedMappings = 0;
    for (const entry of allGroupEntries(groups)) {
        for (const mapping of entry.mappings) {
            if (mapping.logicalModelId === sourceId) {
                mapping.logicalModelId = targetId;
                movedMappings++;
            }
        }
    }

    for (const group of groups) {
        if (group.currentLogicalModelId === sourceId) group.currentLogicalModelId = targetId;
    }

    const removedLogicalModelId = sourceId;
    const index = logicalModels.findIndex(model => model.id === sourceId);
    if (index >= 0) logicalModels.splice(index, 1);

    return { movedMappings, removedLogicalModelId };
}

/** 删除逻辑模型：移除名下全部映射、删除逻辑模型、清空分组当前模型指针。返回删除的映射条数。 */
export function deleteLogicalModel(
    logicalModels: LogicalModel[],
    groups: Group[],
    logicalModelId: string,
): { removedMappings: number } {
    let removedMappings = 0;
    for (const entry of allGroupEntries(groups)) {
        const before = entry.mappings.length;
        entry.mappings = entry.mappings.filter(mapping => mapping.logicalModelId !== logicalModelId);
        removedMappings += before - entry.mappings.length;
    }
    for (const group of groups) {
        if (group.currentLogicalModelId === logicalModelId) group.currentLogicalModelId = '';
    }
    const index = logicalModels.findIndex(model => model.id === logicalModelId);
    if (index >= 0) logicalModels.splice(index, 1);
    return { removedMappings };
}

/** 模型列表导出（txt）：所有 Key 已拉取真实模型名，每行一个，去重并按名称排序。刻意不含任何密钥字段。 */
export function buildModelListText(groups: Group[]): string {
    const names = new Set<string>();
    for (const entry of allGroupEntries(groups)) {
        for (const model of entry.fetchedModels) {
            const trimmed = String(model || '').trim();
            if (trimmed) names.add(trimmed);
        }
    }
    return [...names].sort((a, b) => a < b ? -1 : a > b ? 1 : 0).join('\n');
}

/** Vendor token 限制换算（ST 语义：总上下文预算 = 输入预算 + 输出上限）。
 *  Vendor 三个上限都可选（0 = 不限制）。返回需要钳制的目标值；无限制时对应字段为 undefined。 */
export function computeVendorTokenClamps(
    vendor: Pick<Vendor, 'maxContext' | 'maxInputTokens' | 'maxOutputTokens'>,
    current: { maxContext: number; maxOutputTokens: number },
): { maxContext?: number; maxOutputTokens?: number } {
    const maxContext = Number(vendor?.maxContext) || 0;
    const maxInputTokens = Number(vendor?.maxInputTokens) || 0;
    const maxOutputTokens = Number(vendor?.maxOutputTokens) || 0;
    const currentContext = Number(current?.maxContext) || 0;
    const currentOutput = Number(current?.maxOutputTokens) || 0;

    const result: { maxContext?: number; maxOutputTokens?: number } = {};

    // 输出上限：直接钳制 ST openai_max_tokens
    if (maxOutputTokens > 0 && maxOutputTokens !== currentOutput) {
        result.maxOutputTokens = maxOutputTokens;
    }

    // 总上下文：优先显式 maxContext；否则若设置了输入上限，按 输入 + 输出预算 推导
    if (maxContext > 0) {
        if (maxContext !== currentContext) result.maxContext = maxContext;
    } else if (maxInputTokens > 0) {
        const outputBudget = maxOutputTokens > 0 ? maxOutputTokens : currentOutput;
        const derived = maxInputTokens + outputBudget;
        if (derived !== currentContext) result.maxContext = derived;
    }

    return result;
}

const SPECIAL_VARIANT_RE = /(?:search|thinking|image|cache)/i;

/** 特殊变体判断：模型名含 search/thinking/image/cache（大小写不敏感）视为非对话用途，跳过。 */
export function isSpecialVariant(name: string): boolean {
    return SPECIAL_VARIANT_RE.test(String(name || '').trim());
}

/** 提取核心模型名：剥离渠道/变体前缀（[xx]、gcli-、假流式-、xxx/）与末尾的 -假流式，统一小写；同一核心模型的不同变体归并。 */
export function canonicalModelName(raw: string): string {
    let name = String(raw || '').trim();
    name = name.replace(/^\[[^\]]*\]/, '');
    const slashIndex = name.lastIndexOf('/');
    if (slashIndex >= 0) name = name.slice(slashIndex + 1);
    name = name.replace(/^gcli-/, '').replace(/^假流式-/, '');
    name = name.replace(/-假流式$/, '');
    return name.toLowerCase();
}

/** 从已拉取模型批量创建逻辑模型并自动映射：每个核心模型独立创建一个（渠道/假流式变体合并，统一小写），跳过 search/thinking/image 变体。
 *  自动映射：核心名匹配的逻辑模型建立后，把各 Key 中未映射的真实模型映射过去。
 *  全部重置重算：已有映射只要不是指向 canonical 同名逻辑模型，一律重置到 canonical 逻辑模型（覆盖手动映射）。
 *  返回 created / skipped / mapped / rebuilt 数。 */
export function buildLogicalModelsFromFetched(
    models: string[],
    logicalModels: LogicalModel[],
    groups: Group[] = [],
): { created: LogicalModel[]; skipped: string[]; mapped: number; rebuilt: number } {
    const existingNames = new Set(logicalModels.map(model => String(model.name || '').trim().toLowerCase()));
    const seen = new Set<string>();
    const created: LogicalModel[] = [];
    const skipped: string[] = [];
    let mapped = 0;
    let rebuilt = 0;
    for (const raw of models) {
        const name = String(raw || '').trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        if (isSpecialVariant(name)) {
            skipped.push(name);
            continue;
        }
        const canonical = canonicalModelName(name);
        if (!existingNames.has(canonical.toLowerCase())) {
            const model = normalizeLogicalModel({ name: canonical });
            logicalModels.push(model);
            existingNames.add(canonical.toLowerCase());
            created.push(model);
        }
        const target = findLogicalByNameCI(logicalModels, canonical);
        if (!target) continue;
        // 统一小写：已存在的同名逻辑模型把名字规范成小写核心名
        if (String(target.name || '') !== canonical) target.name = canonical;
        for (const entry of allGroupEntries(groups)) {
            if (!entry.fetchedModels.includes(name)) continue;
            const existing = entry.mappings.find(mapping => mapping.realModel === name);
            if (!existing) {
                entry.mappings.push({ id: makeId('mapping'), realModel: name, logicalModelId: target.id });
                mapped++;
                continue;
            }
            // 全部重置重算：只要不是 canonical 同名逻辑模型就改为 target（覆盖手动映射）
            if (existing.logicalModelId !== target.id) {
                existing.logicalModelId = target.id;
                rebuilt++;
            }
        }
    }
    return { created, skipped, mapped, rebuilt };
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

/** 逻辑模型按名称排序（大小写不敏感，localeCompare 兼顾中文）。不修改原数组。 */
export function sortedLogicalModels(logicalModels: LogicalModel[]): LogicalModel[] {
    return [...(logicalModels || [])].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { sensitivity: 'base' }));
}

export function normalizeGroupEntry(raw: Record<string, any> | undefined): GroupEntry {
    return {
        id: normalizeText(raw?.id) || makeId('group-entry'),
        vendorId: normalizeText(raw?.vendorId).slice(0, 200),
        apiKey: normalizeText(raw?.apiKey).slice(0, 2048),
        label: sanitizeName(raw?.label) || 'Key',
        enabled: raw?.enabled === undefined ? true : Boolean(raw.enabled),
        fetchedModels: normalizeModelList(raw?.fetchedModels),
        mappings: normalizeMappings(raw?.mappings),
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

/** 旧 Provider/Key 过渡实现 → Vendor / Group 迁移。
 *  只建立 Vendor 与 GroupEntry（Key）结构：apiKey/label/enabled 保留；旧模型数据（fetchedModels/mappings/逻辑模型）丢弃，等拉取重建。 */
export function migrateProvidersToVendorModel(providers: Provider[] | undefined): VendorMigrationResult {
    const logicalModels = new Map<string, LogicalModel>();
    const vendors: Vendor[] = [];
    const entries: GroupEntry[] = [];

    for (const provider of providers || []) {
        const firstKey = provider?.keys?.[0];
        vendors.push(normalizeVendor({
            id: provider.id,
            name: provider.name,
            format: provider.format,
            endpoint: provider.endpoint,
            enabled: provider.enabled,
            rpm: firstKey?.rpm ?? VENDOR_RPM_DEFAULT,
            weight: firstKey?.weight ?? VENDOR_WEIGHT_DEFAULT,
            updatedAt: provider.updatedAt,
        }));
        for (const key of provider?.keys || []) {
            entries.push(normalizeGroupEntry({
                vendorId: provider.id,
                apiKey: key.apiKey,
                label: key.label || 'Key',
                enabled: key.enabled,
            }));
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
