// UI 辅助纯函数：判断 Vendor / Key 是否未使用（用于面板灰色高亮）

export interface KeyEntry {
    enabled: boolean;
    apiKey: string;
    vendorId?: string;
}

export interface VendorEntry {
    enabled: boolean;
}

/**
 * Key 是否未使用：禁用或未填 API Key。
 */
export function isKeyUnused(entry: KeyEntry): boolean {
    return !entry.enabled || !entry.apiKey;
}

/**
 * Vendor 是否未使用：禁用，或当前分组无可用 Key（启用且已填 Key）。
 * @param vendorId 该 Vendor 的 id，用于筛选属于它的条目
 */
export function isVendorUnused(vendor: VendorEntry, vendorId: string, groupEntries: KeyEntry[]): boolean {
    if (!vendor.enabled) return true;
    const ownEntries = groupEntries.filter(e => e.vendorId === vendorId);
    return !ownEntries.some(e => e.enabled && e.apiKey);
}