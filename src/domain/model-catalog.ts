// 模型注册表与路由单元：key 粒度。
// 模型记录自己的承载供应商（unit = { provider, key }），承载判定按 key.fetchedModels。
// 纯计算。

import type { LogicalModel, ModelEntry, Provider, RoutingUnit, Vendor } from '../types.js';

/** 展平全部路由单元：每个 provider 的每个 key 一个单元。 */
export function keyUnits(providers: Provider[]): RoutingUnit[] {
    const units: RoutingUnit[] = [];
    for (const provider of providers || []) {
        for (const key of provider?.keys || []) {
            units.push({ provider, key });
        }
    }
    return units;
}

/** 单元唯一标识（sticky/去重用）。 */
export function unitId(unit: RoutingUnit): string {
    return `${unit.provider?.id}::${unit.key?.id}`;
}

/** 承载指定模型的单元列表（模型记录自己的供应商；不含可用性过滤，那是 routing 的职责）。 */
export function unitsCarryingModel(providers: Provider[], model: string): RoutingUnit[] {
    return keyUnits(providers).filter(({ key }) => (key?.fetchedModels || []).includes(model));
}

/** 模型注册表：全部模型（按 key.fetchedModels 聚合去重），每个模型记录承载单元。 */
export function modelRegistry(providers: Provider[]): ModelEntry[] {
    const byModel = new Map<string, ModelEntry>();
    for (const unit of keyUnits(providers)) {
        for (const model of unit.key?.fetchedModels || []) {
            if (!model) continue;
            const entry = byModel.get(model) ?? { model, units: [] };
            entry.units.push(unit);
            byModel.set(model, entry);
        }
    }
    return [...byModel.values()];
}

/** 聚合模型清单（registry 的 model 列表）。 */
export function aggregateModels(providers: Provider[]): string[] {
    return modelRegistry(providers).map(entry => entry.model);
}

/** 模型名是否参与路由：命中旧 Provider 聚合模型、新 Vendor 映射的真实模型名、或逻辑模型 id/name。 */
export function isRoutedModel(
    providers: Provider[],
    vendors: Vendor[],
    logicalModels: LogicalModel[],
    model: string,
): boolean {
    const value = String(model || '').trim();
    if (!value) return false;
    if (aggregateModels(providers).includes(value)) return true;
    for (const vendor of vendors || []) {
        for (const mapping of vendor?.mappings || []) {
            if (mapping.realModel === value) return true;
        }
    }
    for (const logical of logicalModels || []) {
        if (logical.id === value || logical.name === value) return true;
    }
    return false;
}

/** 按 key 分组的模型清单（UI 分组视图用）。 */
export function modelsGroupedByKey(providers: Provider[]): { provider: Provider; key: RoutingUnit['key']; models: string[] }[] {
    return keyUnits(providers).map(({ provider, key }) => ({
        provider,
        key,
        models: key?.fetchedModels || [],
    }));
}
