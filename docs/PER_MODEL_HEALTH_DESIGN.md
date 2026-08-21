# 设计稿：渠道（GroupEntry）× 真实模型 级被动健康检测与熔断

> **✅ 状态：已按本设计稿实现**
>
> 本文件是本项目的历史设计稿。完整实现见：
> - `src/domain/model-health.ts` — 错误分类、失败/成功记账、指数退避
> - `src/domain/group-routing.ts` `modelUnitUnavailabilityReason` — 模型冷却过滤
> - `src/routing/failure-observer.ts` — `end()` 返回 `FailureProbe`
> - `src/routing/hooks.ts` `onGenerationEnded` — 模型级记账（`recordModelFailure/recordModelSuccess`）
> - `src/types.ts` — `ModelFailureKind` + `GroupEntry` 健康字段
> - `SCHEMA_VERSION` 已达到 14
>
> 当前代码行为：**GroupEntry(Key) × realModel 级熔断**，所有可冷却错误统一使用 `baseCooldown × multiplier`（默认 `cooldownSeconds × 1000`，倍数 1→2→4→…→32）。`fatal`/`rate_limited` 立即进入该公式的冷却，`temp`/`unknown` 达失败阈值后进入；`bad_request` 不计失败，空回复只记录观测。错误与空回复还会追加进全局 200 条滑动窗口 `observationHistory`，控制台实时展示。冷却到期即恢复可路由，下一次真实请求自然验证。
>
> 本设计稿保留为实施参考和文档索引。

> 目标：把可用性状态的粒度从 **Vendor 级** 下沉到 **GroupEntry(Key) × realModel 级**，
> 纯被动（不主动测 vendor、不调 `/models`），完全在现有扩展架构内落地，
> 不引入服务端 / PostgreSQL / Redis，不改变「由 ST 原生发请求」这一根本约束。

---

## 0. 背景：我们到底缺什么

### 现状（Vendor 级熔断，存在误伤）

当前新路由链路（Vendor / Group）在失败时是「整个 Vendor 级禁用」：

- `hooks.ts` `onGenerationEnded` → `recordVendorFailure(vendor, ...)` → 连续失败达阈值 → `vendor.enabled = false`。
- 结果：Vendor B 同时承载 `gpt-4o` 与 `gemini-pro`，若 `gemini-pro` 连挂，**整个 Vendor B 被禁**，`gpt-4o` 无辜受损。

### 其实这个项目早就有正确答案

旧 Provider 层（`src/domain/provider.ts` / `routing.ts`）**已经有「key × model」级熔断**：

- `ProviderKey.circuits: Record<model, until>`（`isModelCircuitOpen`）
- `ProviderKey.failStreakByModel: Record<model, number>`（`recordFailure`）
- 注释明言：*"熔断针对 (key × 模型)：一个模型熔断后，同 key 的其他模型仍可选"*。

但新 Vendor/Group 层（`group-routing.ts` + `hooks.ts`）**把这个能力弄丢了**，退回 VendEnglish 级 `enabled=false`。所以本设计的核心，其实就是**把旧 Provider 层的成熟模式，原样搬进新的 GroupEntry 层**，并补上「错误分类」与「指数退避 + 半开（用真实流量验证）」。

---

## 1. 数据模型改动（纯增量，不改旧字段语义）

只在 `GroupEntry` 上新增运行时健康字段（仿造旧 `ProviderKey` 的做法）。这些字段**承载到设置里持久化**（跨会话保留成功率/禁用），但**窗口/冷却这类纯运行时字段载入即重置**（沿用现有 `resetVendorRuntimeState` / `resetRoutingRuntimeState` 的模式）。

### 1.1 类型（`src/types.ts`）

```ts
/** 错误分类（从宿主错误提示或生成正文中的 API 错误标记推断，纯被动、无返回码）。 */
export type ModelFailureKind =
  | 'fatal'         // 不可恢复：模型不存在 / 余额不足 / 401/403 / 封禁 → 立即禁用该 realModel
  | 'rate_limited'  // 429 / rate limit → 只短冷却，不累计连续失败
  | 'temp'          // 超时 / 5xx / 连接失败 / 网络 → 计入连续失败，达阈值冷却
  | 'bad_request'   // 400 / 参数 / 格式错误 → 不是渠道故障，不处理
  | 'unknown';      // 无法归类 → 按 temp 稳妥处理

export interface GroupEntry {
  id: string;
  vendorId: string;
  apiKey: string;
  secretId?: string;
  label: string;
  enabled: boolean;
  fetchedModels: string[];
  mappings: VendorModelMapping[];

  // ── 新增（按 realModel 粒度，仿旧 ProviderKey 的 circuits/failStreakByModel）──
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
```

> 说明：**不新增「禁用清单字段」**。不可恢复错误（fatal）也使用统一的 `circuitsByModel[realModel] = now + baseCooldown * multiplier` 表达，路由层把“冷却中”视为不可路由，效果等同于禁用，但冷却结束可自动恢复，无需人工。
> 这样统一用一个 `circuitsByModel` 表达临时冷却和长时间冷却，不需要多维护一个 `disabledModels` 列表。

### 1.2 归一化（`src/domain/vendor.ts`）

在 `normalizeGroupEntry` 里新增这几行的归一化（空值安全）：

```ts
export function normalizeGroupEntry(raw: Record<string, any> | undefined): GroupEntry {
  // ...现有字段...
  failStreakByModel: normalizeStringMap(raw?.failStreakByModel, 'number'),
  circuitsByModel: normalizeStringMap(raw?.circuitsByModel, 'number'),
  lastErrorKindByModel: normalizeStringMap(raw?.lastErrorKindByModel, 'string'),
  cooldownMultiplierByModel: normalizeStringMap(raw?.cooldownMultiplierByModel, 'number'),
  lastErrorByRealModel: normalizeStringMap(raw?.lastErrorByRealModel, 'string'),
}

/** 载入时重置纯运行时字段（沿用 resetVendorRuntimeState 的理念）。 */
export function resetGroupRuntimeState(groups: Group[]): void {
  for (const entry of allGroupEntries(groups)) {
    entry.failStreakByModel = {};
    // circuits/kind/multiplier/lastError 保留（跨会话诊断），但「已过期的冷却」按可恢复处理
  }
}
```

（在 `settings/initialize.ts` 的 `resetVendorRuntimeState(value.vendors);` 旁追加一行 `resetGroupRuntimeState(value.groups);`。）

---

## 2. 阈值与退避参数（纯常量，放 `src/constants.ts` 或复用 `RoutingSettings`）

沿用现有 `RoutingSettings`（`failThreshold`、`cooldownSeconds`），在其语义上加「按模型粒度」与「退避」：

| 参数 | 建议值 | 来源/说明 |
|---|---|---|
| `failThreshold` | 3（现有默认值） | 复用现有 `RoutingSettings.failThreshold`；`temp/unknown` 达阈值，`fatal/rate_limited` 立即触发 |
| `baseCooldownMs` | `RoutingSettings.cooldownSeconds * 1000`（默认 300s） | 所有可冷却分类共用 |
| `maxCooldownMultiplier` | 32 | 指数退避上限 = base * 32 |
| 窗口错误率阈值 | >50% 且 窗口请求数 ≥ 5 | （可选，第一期可只做连续失败，不引入窗口计数） |

> 第一版建议**只做「连续失败 → 冷却 / 指数退避」**，暂不做滑动窗口错误率（那需要额外的窗口计数维护，复杂度高、收益边际）。把窗口错误率列为二期。

---

## 3. 路由过滤改动（`src/domain/group-routing.ts`）

关键：在现有 `groupUnitUnavailabilityReason` 里，**在 Vendor/entry 检查之后，追加模型级检查**。这是把粒度从 Vendor 下沉到模型的真正落点。

```ts
/** groupUnitUnavailabilityReason 追加一条：该 Key 上该 realModel 是否冷却中。 */
export function modelUnitUnavailabilityReason(unit: GroupRouteUnit, now: number): string | null {
  const entry = unit?.entry;
  const realModel = unit?.mapping?.realModel;
  if (!entry || !realModel) return null;
  const until = entry.circuitsByModel?.[realModel];
  if (until && now < until) return 'cooldown';
  return null;
}
```

在 `groupUnitUnavailabilityReason` 末尾加上：

```ts
const modelReason = modelUnitUnavailabilityReason(unit, now);
if (modelReason) return modelReason;
```

这样 `candidateGroupUnits` 就会自动排除「该 Key 上该模型处于冷却」的单元，**同 Key 的其它模型不受影响**。

**注意粒度：`circuitsByModel` 挂在 `GroupEntry`（Key）上，key 为 `mapping.realModel`**。所以同一 Key 下不同 realModel 各自独立冷却——正是"渠道×模型"原则。

---

## 4. 失败处理（新纯函数模块 `src/domain/model-health.ts`）

> 参照旧 `provider.ts` 的 `recordFailure`（已证实的模式），扩成：错误分类 + 指数退避 + 半开。

### 4.1 错误分类（纯函数）

```ts
export function classifyModelFailureMessage(msg: string): ModelFailureKind {
  const m = String(msg ?? '').toLowerCase();
  if (/(model[_ -]?not[_ -]?found|no such model|model .* not exist|insufficient[_ -]?quota|no quota|balance|401|403|permission|banned|invalid api key|account disabled|access denied|forbidden|unauthorized|payment required|模型不存在|模型未找到|余额不足|配额不足|密钥无效|无权限|禁止访问|账户禁用|账号禁用|欠费)/i.test(m)) {
    return 'fatal';
  }
  if (/(429|rate ?limit|too many requests|quota exceeded|限流|请求过多|频率限制|配额超限)/i.test(m)) {
    return 'rate_limited';
  }
  if (/(400|bad request|parameter|invalid request|invalid parameter|format|invalid input|validation error|请求无效|参数错误|参数无效|格式错误|验证失败)/i.test(m)) {
    return 'bad_request';
  }
  if (/(failed to fetch|load failed|network|timed out|abort|timeout|5\d{2}|server error|service unavailable|internal error|网络|超时|服务(?:暂时)?不可用|服务器错误|内部错误|连接失败)/i.test(m)) {
    return 'temp';
  }
  return 'unknown';
}
```

除宿主错误提示外，路由窗口结束时还读取 SillyTavern 已写入的最新聊天消息正文。以下标记在正文开头时都会视为 API 失败：

- `[API错误]`
- `[API 错误]`
- `[API Error]`
- `【API错误】` / `【API 错误】`

标记允许普通空白、全角空格和标记后无空格；正文中间出现这些词不会触发。标记后的英文或常见中文错误（如“模型不存在”“余额不足”“请求过多”“服务暂时不可用”）交给同一分类器，分别归为 fatal、rate_limited 或 temp。

```ts
const marked = /^\s*(?:\[|【)\s*api\s*(?:错误|error)\s*(?:\]|】)\s*/iu;
```

### 4.2 空回复观测（不计失败）

如果生成结束时最新 assistant 消息是空白字符串，系统记录 `empty_response` 观测和 `[EMPTY_RESPONSE]` 诊断文本，但不会：

- 增加 Vendor 失败数；
- 增加 `failStreakByModel`；
- 触发或延长模型冷却；
- 将该次结果计入 Vendor 成功数。

空回复不会自动重试，也不会被当作成功恢复已有冷却。真正的 API 错误优先级高于空回复观测。

### 4.3 成功处理

```ts
/** 生成成功 → 该 Key 上该 realModel 恢复健康。 */
export function recordModelSuccess(entry: GroupEntry, realModel: string): void {
  delete entry.failStreakByModel?.[realModel];
  delete entry.circuitsByModel?.[realModel];          // 清冷却（半开复活的落点）
  if (entry.cooldownMultiplierByModel) entry.cooldownMultiplierByModel[realModel] = 1;
  if (entry.lastErrorByRealModel) delete entry.lastErrorByRealModel[realModel];
  if (entry.lastErrorKindByModel) delete entry.lastErrorKindByModel[realModel];
}
```

### 4.5 全局观测历史（错误 + 空回复，滑动窗口）

除按 `GroupEntry × realModel` 的最近一次诊断字段外，每次失败与空回复观测还会追加进**全局有界历史** `QuickerApiSettings.observationHistory`：

```ts
/** 生成错误与空回复的全局滑动窗口记录（按时间顺序，最多 200 条）。 */
export interface ModelObservationRecord {
  occurredAt: number;     // Date.now()
  groupId: string;        // 本次生成所在 Group
  vendorId: string;
  entryId: string;
  realModel: string;
  logicalModelId: string;
  kind: ModelObservationKind;  // fatal | rate_limited | temp | bad_request | unknown | empty_response
  message: string;        // 截断 500 字符
}
```

- 上限 `MODEL_OBSERVATION_HISTORY_LIMIT = 200`；超限时删除最早记录（滑动窗口），**不再按模型只保留一条**。
- 空回复与错误都记录（`empty_response` 标记为“不计失败”，但保留在历史中）。
- 追加点：`hooks.ts` `onGenerationEnded`（成功不记录）；持久化在 `init.ts` 的 `recordObservation`，落盘后派发 `MODEL_OBSERVATION_RECORDED_EVENT`，控制台（桌面三栏 / 手机底部面板）监听后实时刷新“最近错误与结果观测”区块。
- 载入时 `normalizeObservationHistory` 过滤非法条目并按时间截断到 200 条；跨机导入/导出时不携带该字段（与其它健康字段一致）。

### 4.4 失败处理（核心：分类 + 退避 + 半开语义）

```ts
export interface RecordModelFailureOptions {
  threshold?: number;          // 复用 RoutingSettings.failThreshold
  baseCooldownMs?: number;     // 复用 RoutingSettings.cooldownSeconds * 1000，所有可冷却分类共用
  maxCooldownMultiplier?: number;
}

/** 记录失败；fatal/rate_limited 立即触发，temp/unknown 达阈值触发，冷却公式统一。 */
export function recordModelFailure(
  entry: GroupEntry,
  realModel: string,
  kind: ModelFailureKind,
  error: string,
  opts: RecordModelFailureOptions = {},
  now = Date.now(),
): boolean {
  const base = Math.max(1, Math.floor(Number(opts.baseCooldownMs) || 300_000));
  const threshold = Math.max(1, Math.floor(Number(opts.threshold) || 3));
  const maxMul = Math.max(1, Math.floor(Number(opts.maxCooldownMultiplier) || 32));

  entry.lastErrorByRealModel ??= {};
  entry.lastErrorKindByModel ??= {};
  entry.lastErrorByRealModel[realModel] = String(error ?? '').slice(0, 500);
  entry.lastErrorKindByModel[realModel] = kind;
  if (kind === 'bad_request') return false;

  entry.failStreakByModel ??= {};
  entry.cooldownMultiplierByModel ??= {};
  const immediate = kind === 'fatal' || kind === 'rate_limited';
  const streak = (Number(entry.failStreakByModel[realModel]) || 0) + 1;
  entry.failStreakByModel[realModel] = streak;
  if (!immediate && streak < threshold) return false;

  const mul = Math.min(Math.max(1, Math.floor(Number(entry.cooldownMultiplierByModel[realModel]) || 1)), maxMul);
  entry.circuitsByModel ??= {};
  entry.circuitsByModel[realModel] = now + base * mul;
  entry.cooldownMultiplierByModel[realModel] = Math.min(mul * 2, maxMul);
  delete entry.failStreakByModel[realModel];
  return true;
}
```

### 4.5 半开（冷却结束用真实流量自动验证）

沿用现有架构：**冷却到点后路由层自然恢复该单元为可用**（`circuitsByModel[realModel] <= now` 即放行）。首版实现**不做并发限制的半开闸门**，而是"冷却到期即恢复可路由，下一次真实请求自然验证"——成功则 `recordModelSuccess` 归零，失败则 `recordModelFailure` 按退避再次冷却（此时 multiplier 已翻倍）。这已经满足「纯被动 + 指数退避 + 真实流量自动恢复」，且比手动启用省心很多。

> 若后续想更贴近文档的 half_open（只放 1 个并发试探），可在 `candidateGroupUnits` 里对"刚过期的冷却"额外限流——列为可选增强，不在首期。

---

## 5. 接线改动（`src/routing/failure-observer.ts` + `hooks.ts`）

### 5.1 failure-observer：分类并区分错误与结果观测

`end()` 返回 `FailureProbe | null`：错误返回分类，空白 assistant 回复返回 `empty_response`，无观测返回 `null`。

```ts
export interface FailureProbe {
  kind: ModelObservationKind; // 错误分类或 empty_response
  message: string;             // 原始消息或 [EMPTY_RESPONSE]（截断）
}

export interface FailureObserver {
  install(): void;
  uninstall(): void;
  begin(): void;
  observeResponseText(text: unknown): void;
  end(): FailureProbe | null;
}
```

> 注意：`bad_request` 命中了现有错误消息之外一般也未必触发（那个正则是网络类）。凡能触发现有失败观察的，基本是 temp/fatal/rate_limited，`bad_request` 主要用于“如果消息恰好含 400”时避免误伤。

### 5.2 hooks.ts：onGenerationEnded 按 realModel 记账

空回复只调用 `recordModelObservation()` 保存诊断，不调用失败记账，也不增加 Vendor 成功数；真正错误才调用 `recordModelFailure()`。

```ts
const probe = deps.endGeneration?.();
if (!probe) {
  recordVendorSuccess(vendor);
  recordModelSuccess(entry, realModel);
} else if (probe.kind === 'empty_response') {
  recordModelObservation(entry, realModel, probe.kind, probe.message);
} else {
  recordModelFailure(entry, realModel, probe.kind, probe.message, {
    threshold: routing.failThreshold,
    baseCooldownMs: routing.cooldownSeconds * 1000,
  });
  vendor.failures = (Number(vendor.failures) || 0) + 1;
}
```

**关键决策：一期默认不再 `recordVendorFailure → enabled=false`**（因为有了模型级冷却，整个 Vendor 被误禁的场景已消除）。若希望保留"整商兜底"，可改成「该 Vendor 下所有承载模型都处于冷却时才禁」——但这会引入"哪些模型属于哪个 Vendor"的聚合，一期先不做，保持模型级即可。

---

## 6. UI 展示（可选，二期）

- 在 Group 条目（Key）展开区，按 realModel 展示健康标记：`健康 / 冷却中(剩余xx s) / 退避xN / 不可恢复(6h)`。
- 提供「手动恢复该 Key 该模型」按钮 → 调 `recordModelSuccess` 清除该模型的冷却。
- 在 toastr 失败提示里带上模型名与冷却时长（`${realModel} 连续失败，冷却 ${n} 秒`）。

---

## 7. 测试计划（新增，覆盖纯函数为主）

| 文件 | 覆盖 |
|---|---|
| `model-health.test.ts` | `classifyModelFailureMessage` 各分类；`recordModelFailure` 连续失败→冷却、退避翻倍、fatal 立即禁用、rate_limited 不累计、bad_request 不处理；`recordModelSuccess` 清冷却/归倍数 |
| `group-routing-health.test.ts` | `groupUnitUnavailabilityReason` 对冷却中模型返回 `cooldown`；同 Key 另一模型不受影响；冷却到期后恢复可选 |
| `failure-observer.test.ts` | `end()` 返回分类与消息；无失败返回 null |
| 现有 `vendor-*` / 迁移测试 | 在 `normalizeGroupEntry` 新增字段后仍全绿（`npm test`） |

迁移：`SCHEMA_VERSION` 12 → 13，新增字段走 `normalizeGroupEntry` 默认补全，旧数据无破坏。

---

## 8. 为什么这套能在我们的约束下成立

- **纯被动**：只在真实生成的成功/失败（`GENERATION_ENDED` + 宿主错误提示或最终正文标记）时记账，不主动调 vendor、不调 `/models`。半开验证也用真实流量。
- **无服务端**：全部是 `GroupEntry` 上的字段 + 纯函数，不引入 Postgres/Redis。
- **不改变 ST 发请求的约束**：我们仍只改连接字段，失败由 ST 原生反馈，我们只"读"。
- **粒度正确**：熔断落在 `GroupEntry(Key) × realModel`，一个模型挂不影响同 Key 其它模型、不影响同 Vendor 其它 Key——正是设计文档第一原则，也是旧 Provider 层已证实的模式。
- **可增量落地**：先类型+纯函数+路由过滤+记账，UI/半开/窗口错误率都做二期，不影响现有功能与测试。

---

## 9. 实施顺序

1. `types.ts` 加字段、`vendor.ts` `normalizeGroupEntry` + `resetGroupRuntimeState`、`SCHEMA_VERSION` 13、initialize 接上 → 迁移安全。
2. 新增 `src/domain/model-health.ts`（分类 + 失败/成功记账 + 退避）。
3. `group-routing.ts` 加模型级冷却过滤。
4. `failure-observer.ts` `end()` 返回 `FailureProbe`。
5. `hooks.ts` `onGenerationEnded` 改模型级记账（Vendor 级禁用改为可选兜底 / 一期移除）。
6. 补单测，`npm test` 全绿；`npm run typecheck` / `npm run build` 通过。
7. （二期）UI 健康标记 + 手动恢复 + 半开闸门 + 窗口错误率。
