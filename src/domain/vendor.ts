// Vendor / LogicalModel / Group 领域纯函数。
// 新路由模型与旧 Provider/Key 过渡实现共存：providers 保留作为一次性迁移来源。

import { normalizeModelList } from '../utils/model-list.js';
import { normalizeText, sanitizeName } from '../utils/text.js';
import { makeId } from '../utils/id.js';
import type {
    Group,
    GroupEntry,
    LogicalModel,
    MappingRule,
    ModelObservationKind,
    Vendor,
    VendorFormat,
    VendorModelMapping,
} from '../types.js';

export const VENDOR_RPM_DEFAULT = 3;
export const VENDOR_WEIGHT_DEFAULT = 1;

export const PROVIDER_FORMATS: VendorFormat[] = ['custom', 'deepseek'];

export function normalizeProviderFormat(value: unknown): VendorFormat {
    const v = String(value ?? '').trim();
    return (PROVIDER_FORMATS as string[]).includes(v) ? (v as VendorFormat) : 'custom';
}

export function normalizeVendorModelMapping(raw: Record<string, any> | undefined): VendorModelMapping {
    const weight = Number(raw?.weight);
    return {
        id: normalizeText(raw?.id) || makeId('mapping'),
        realModel: normalizeText(raw?.realModel).slice(0, 500),
        logicalModelId: normalizeText(raw?.logicalModelId).slice(0, 200),
        weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
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

/** 当 Vendor 下已配置的 Key 全部不可用时自动禁用 Vendor；没有配置 Key 时不处理。 */
export function disableVendorIfNoUsableKeys(vendor: Vendor, groups: Group[]): boolean {
    if (!vendor || vendor.enabled === false) return false;
    const entries = allGroupEntries(groups).filter(entry => entry.vendorId === vendor.id && entry.apiKey);
    if (entries.length === 0 || entries.some(entry => entry.enabled)) return false;
    vendor.enabled = false;
    vendor.disabledReason = '所有 Key 均已失效，已自动禁用';
    return true;
}

/** 真实模型是否仍可用：至少一个启用 Vendor + 启用 Key 承载它（fetchedModels 或 mappings 命中）。 */
export function isRealModelUsable(vendors: Vendor[], groups: Group[], realModel: string): boolean {
    const name = String(realModel || '').trim();
    if (!name) return false;
    for (const entry of allGroupEntries(groups)) {
        if (entry.enabled === false || !entry.apiKey) continue;
        const carries = entry.fetchedModels.includes(name) || entry.mappings.some(mapping => mapping.realModel === name);
        if (!carries) continue;
        const vendor = (vendors || []).find(item => item.id === entry.vendorId);
        if (vendor && vendor.enabled !== false) return true;
    }
    return false;
}

export function normalizeLogicalModel(raw: Record<string, any> | undefined): LogicalModel {
    return {
        id: normalizeText(raw?.id) || makeId('logical'),
        name: sanitizeName(raw?.name) || 'Logical Model',
        matchPattern: String(raw?.matchPattern ?? '').slice(0, 500),
        customIncludeBody: String(raw?.customIncludeBody ?? '').slice(0, 100000),
        customExcludeBody: String(raw?.customExcludeBody ?? '').slice(0, 100000),
        customIncludeHeaders: String(raw?.customIncludeHeaders ?? '').slice(0, 100000),
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

/**
 * 识别“渠道前缀-已知模型名”：只接受当前已有逻辑模型名作为后缀，且选择最长后缀。
 * 这样不会把 gemini-3.5-flash-lite 按第一个短横线错误拆成前缀和模型名。
 */
function findLogicalByKnownSuffix(logicalModels: LogicalModel[], realModel: string): LogicalModel | null {
    const value = String(realModel || '').trim().toLowerCase();
    if (!value) return null;
    let match: LogicalModel | null = null;
    let matchLength = 0;
    for (const model of logicalModels) {
        const name = String(model?.name || '').trim().toLowerCase();
        if (!name || value === name || !value.endsWith(`-${name}`)) continue;
        if (name.length > matchLength) {
            match = model;
            matchLength = name.length;
        }
    }
    return match;
}

/** 拉取模型后的归类：正则命中 → 名称精确匹配 → 已知模型最长后缀匹配 → 核心模型名合并 → 新建。 */
export function assignRealModel(logicalModels: LogicalModel[], realModel: string): LogicalModel {
    const byPattern = findLogicalModelByPattern(logicalModels, realModel);
    if (byPattern) return byPattern;
    const byName = findLogicalByNameCI(logicalModels, realModel);
    if (byName) return byName;
    const byKnownSuffix = findLogicalByKnownSuffix(logicalModels, realModel);
    if (byKnownSuffix) return byKnownSuffix;
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
export function pruneOrphanLogicalModels(
    logicalModels: LogicalModel[],
    groups: Group[],
    protectedLogicalModelIds: readonly string[] = [],
): string[] {
    const referenced = new Set(protectedLogicalModelIds);
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
    /** 跨机导入：健康运行时字段（熔断/冷却/诊断）是本机状态，导入的版本无意义 → 一律丢弃；secretId 另有处理。 */
    const dropImportedHealth = (entry: GroupEntry): void => {
        delete entry.failStreakByModel;
        delete entry.circuitsByModel;
        delete entry.lastErrorKindByModel;
        delete entry.cooldownMultiplierByModel;
        delete entry.lastErrorByRealModel;
    };
    for (const rawGroup of imported.groups || []) {
        const group = normalizeGroup(structuredClone(rawGroup));
        if (!group.id) continue;
        const existing = groupById.get(group.id);
        if (existing) {
            const entryById = new Map(existing.entries.map(entry => [entry.id, entry]));
            for (const entry of group.entries) {
                const currentEntry = entryById.get(entry.id);
                // 导入的健康字段一律丢弃，避免覆盖本机熔断状态
                dropImportedHealth(entry);
                // secretId 是本机 secrets 指针，跨机导入无效：保留本机已有值，新条目置空等待重建
                entry.secretId = currentEntry?.secretId ?? '';
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
            // 新 group：所有条目都来自导入，secretId/健康字段一律置空
            for (const entry of group.entries) {
                entry.secretId = '';
                dropImportedHealth(entry);
            }
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

/** 未归类模型：所有 Key 已拉取但无任何映射的真实模型（跨 Key 去重；含特殊变体/embedding/reranker，供用户查看或手动归类）。 */
export function findUnmappedModels(groups: Group[]): string[] {
    const mapped = new Set<string>();
    for (const entry of allGroupEntries(groups)) {
        for (const mapping of entry.mappings) mapped.add(mapping.realModel);
    }
    const result = new Set<string>();
    for (const entry of allGroupEntries(groups)) {
        for (const raw of entry.fetchedModels) {
            const name = String(raw || '').trim();
            if (!name || mapped.has(name)) continue;
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
            entry.mappings.push({ id: makeId('mapping'), realModel, logicalModelId, weight: 1 });
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

// ── 手动批量映射规则（持久化）──

export function normalizeMappingRule(raw: Record<string, any> | undefined): MappingRule {
    return {
        id: normalizeText(raw?.id) || makeId('mapping-rule'),
        pattern: String(raw?.pattern ?? '').trim().slice(0, 500),
        logicalModelId: normalizeText(raw?.logicalModelId).slice(0, 200),
    };
}

export function normalizeMappingRules(raw: unknown): MappingRule[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.map(item => normalizeMappingRule(item)).filter(rule => {
        if (!rule.pattern) return false;
        if (seen.has(rule.id)) return false;
        seen.add(rule.id);
        return true;
    });
}

/** 编译规则正则；非法正则返回 null。 */
function compileRuleRegex(pattern: string): RegExp | null {
    try {
        const re = new RegExp(String(pattern || ''), 'i');
        // 匹配空串空正则
        if (!String(pattern || '').trim()) return null;
        return re;
    } catch {
        return null;
    }
}

/** 预览：命中该正则的真实模型名（跨所有 Key 去重），只读不改。返回 { names, count }。 */
export function previewMappingRule(groups: Group[], pattern: string): { names: string[]; count: number } {
    const re = compileRuleRegex(pattern);
    if (!re) return { names: [], count: 0 };
    const matched = new Set<string>();
    for (const entry of allGroupEntries(groups)) {
        for (const raw of entry.fetchedModels) {
            const name = String(raw || '').trim();
            if (name && re.test(name)) matched.add(name);
        }
    }
    const names = [...matched].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return { names, count: names.length };
}

/**
 * 应用批量映射规则：对所有 Key 中「已拉取且命中正则」的真实模型，映射到目标 logicalModelId（已有映射则改归属）。
 * 返回受影响条目数。命中但 current logicalModelId 相同的条目不计入。
 */
export function applyMappingRule(groups: Group[], rule: MappingRule): number {
    const re = compileRuleRegex(rule?.pattern);
    if (!re || !rule?.logicalModelId) return 0;
    let touched = 0;
    for (const entry of allGroupEntries(groups)) {
        for (const raw of entry.fetchedModels) {
            const name = String(raw || '').trim();
            if (!name || !re.test(name)) continue;
            const existing = entry.mappings.find(mapping => mapping.realModel === name);
            if (existing) {
                if (existing.logicalModelId !== rule.logicalModelId) {
                    existing.logicalModelId = rule.logicalModelId;
                    touched++;
                }
            } else {
                entry.mappings.push({ id: makeId('mapping'), realModel: name, logicalModelId: rule.logicalModelId!, weight: 1 });
                touched++;
            }
        }
    }
    return touched;
}

/** 按保存顺序应用全部批量规则；后面的规则覆盖前面规则对同一真实模型的归属。 */
export function applyMappingRules(groups: Group[], rules: readonly MappingRule[]): number {
    let touched = 0;
    for (const rule of rules ?? []) touched += applyMappingRule(groups, rule);
    return touched;
}

// ── 忽略清单 ──

/** 计算跨所有 Key 已拉取的真实模型中「特殊变体」（embedding/reranker/search/thinking/image/cache）。 */
export function specialVariantModels(groups: Group[]): string[] {
    const names = new Set<string>();
    for (const entry of allGroupEntries(groups)) {
        for (const raw of entry.fetchedModels) {
            const name = String(raw || '').trim();
            if (name && isSpecialVariant(name)) names.add(name);
        }
    }
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** 是否被忽略：用户手动忽略清单 或 特殊变体。 */
export function isIgnoreModel(ignoredModels: string[], name: string): boolean {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return true;
    if (isSpecialVariant(name)) return true;
    return (ignoredModels || []).some(item => String(item).trim().toLowerCase() === n);
}

export function addIgnoreModel(ignoredModels: string[], name: string): string[] {
    const n = String(name || '').trim();
    if (!n) return ignoredModels;
    const result = [...(ignoredModels || [])];
    if (!result.some(item => String(item).trim().toLowerCase() === n.toLowerCase())) result.push(n);
    return result;
}

export function removeIgnoreModel(ignoredModels: string[], name: string): string[] {
    const n = String(name || '').trim().toLowerCase();
    return (ignoredModels || []).filter(item => String(item).trim().toLowerCase() !== n);
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

/** 完整配置导出前脱敏：剥离 GroupEntry.secretId（本机 secrets 指针，不可移植）；apiKey 仍保留。 */
export function sanitizeGroupForExport(group: Group): Group {
    const copy = normalizeGroup(structuredClone(group));
    for (const entry of copy.entries) {
        delete entry.secretId;
        // 健康运行时状态是本机诊断/熔断数据，跨机导入无意义：导出时清空
        delete entry.failStreakByModel;
        delete entry.circuitsByModel;
        delete entry.lastErrorKindByModel;
        delete entry.cooldownMultiplierByModel;
        delete entry.lastErrorByRealModel;
    }
    return copy;
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
 *  Vendor 三个上限都可选（0 = 不限制）。只有当前设置超过 Vendor 上限时才返回钳制目标；
 *  当前已低于/等于上限时不返回（不把用户的设置调高）。 */
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

    // 输出上限：仅当前设置超过上限时钳制
    if (maxOutputTokens > 0 && currentOutput > maxOutputTokens) {
        result.maxOutputTokens = maxOutputTokens;
    }

    // 总上下文：优先显式 maxContext；否则若设置了输入上限，按 输入 + 输出预算 推导
    if (maxContext > 0) {
        if (currentContext > maxContext) result.maxContext = maxContext;
    } else if (maxInputTokens > 0) {
        const outputBudget = maxOutputTokens > 0 ? maxOutputTokens : currentOutput;
        const derived = maxInputTokens + outputBudget;
        if (currentContext > derived) result.maxContext = derived;
    }

    return result;
}

const SPECIAL_VARIANT_RE = /(?:search|thinking|image|cache|embedding|reranker)/i;

/** 特殊变体判断：模型名含 search/thinking/image/cache/embedding/reranker（大小写不敏感）视为非对话用途，跳过建逻辑模型。 */
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
        const knownSuffixTarget = findLogicalByKnownSuffix(logicalModels, name);
        if (!knownSuffixTarget && !existingNames.has(canonical.toLowerCase())) {
            const model = normalizeLogicalModel({ name: canonical });
            logicalModels.push(model);
            existingNames.add(canonical.toLowerCase());
            created.push(model);
        }
        const target = knownSuffixTarget || findLogicalByNameCI(logicalModels, canonical);
        if (!target) continue;
        if (!knownSuffixTarget && String(target.name || '') !== canonical) target.name = canonical;
        for (const entry of allGroupEntries(groups)) {
            if (!entry.fetchedModels.includes(name)) continue;
            const existing = entry.mappings.find(mapping => mapping.realModel === name);
            if (!existing) {
                entry.mappings.push({ id: makeId('mapping'), realModel: name, logicalModelId: target.id, weight: 1 });
                mapped++;
                continue;
            }
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

/** 聚合模型清单：所有 Key 已拉取的真实模型名（去重）。 */
export function aggregateModels(groups: Group[]): string[] {
    const names = new Set<string>();
    for (const entry of allGroupEntries(groups)) {
        for (const model of entry.fetchedModels) {
            if (model) names.add(model);
        }
    }
    return [...names];
}

/** 模型名是否参与路由：命中 Key 映射的真实模型名、或逻辑模型 id/name。 */
export function isRoutedModel(
    groups: Group[],
    logicalModels: LogicalModel[],
    model: string,
): boolean {
    const value = String(model || '').trim();
    if (!value) return false;
    for (const group of groups || []) {
        for (const entry of group?.entries || []) {
            for (const mapping of entry?.mappings || []) {
                if (mapping.realModel === value) return true;
            }
        }
    }
    for (const logical of logicalModels || []) {
        if (logical.id === value || logical.name === value) return true;
    }
    return false;
}

/** 安全归一化 Record<string, number> 映射（过滤非法值）。 */
function normalizeStringNumberMap(raw: unknown): Record<string, number> {
    if (!raw || typeof raw !== 'object') return {};
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw)) {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) result[String(key)] = n;
    }
    return result;
}

/** 安全归一化 Record<string, string> 映射（截断过长值）。 */
function normalizeStringStringMap(raw: unknown, maxLen = 500): Record<string, string> {
    if (!raw || typeof raw !== 'object') return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
        result[String(key)] = String(value ?? '').slice(0, maxLen);
    }
    return result;
}

/** 安全归一化 Record<string, ModelObservationKind> 映射。 */
function normalizeErrorKindMap(raw: unknown): Record<string, ModelObservationKind> {
    if (!raw || typeof raw !== 'object') return {};
    const valid: ModelObservationKind[] = ['fatal', 'rate_limited', 'temp', 'bad_request', 'unknown', 'empty_response'];
    const result: Record<string, ModelObservationKind> = {};
    for (const [key, value] of Object.entries(raw)) {
        const s = String(value ?? '') as ModelObservationKind;
        if (valid.includes(s)) result[String(key)] = s;
    }
    return result;
}

export function normalizeGroupEntry(raw: Record<string, any> | undefined): GroupEntry {
    const weight = Number(raw?.weight);
    return {
        id: normalizeText(raw?.id) || makeId('group-entry'),
        vendorId: normalizeText(raw?.vendorId).slice(0, 200),
        apiKey: normalizeText(raw?.apiKey).slice(0, 2048),
        secretId: normalizeText(raw?.secretId).slice(0, 200),
        label: sanitizeName(raw?.label) || 'Key',
        enabled: raw?.enabled === undefined ? true : Boolean(raw.enabled),
        weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
        fetchedModels: normalizeModelList(raw?.fetchedModels),
        mappings: normalizeMappings(raw?.mappings),
        failStreakByModel: normalizeStringNumberMap(raw?.failStreakByModel),
        circuitsByModel: normalizeStringNumberMap(raw?.circuitsByModel),
        lastErrorKindByModel: normalizeErrorKindMap(raw?.lastErrorKindByModel),
        cooldownMultiplierByModel: normalizeStringNumberMap(raw?.cooldownMultiplierByModel),
        lastErrorByRealModel: normalizeStringStringMap(raw?.lastErrorByRealModel),
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

/** 载入时重置 GroupEntry 纯运行时状态：连续失败计数清零；冷却/分类/退避倍数/失败消息保留（跨会话诊断），「已过期的冷却」由路由层按可恢复处理。 */
export function resetGroupRuntimeState(groups: Group[]): void {
    for (const entry of allGroupEntries(groups)) {
        entry.failStreakByModel = {};
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
    vendor.successes = (Number(vendor.successes) || 0) + 1;
    vendor.failStreak = 0;
    vendor.lastError = '';
}
