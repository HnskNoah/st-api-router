# 交接文档：外部「聚合路由网关」设计评审与落地对照

> 交接对象：下一位继续本插件开发的 agent / 开发者
> 交接目的：评审一份外部提供的「聚合路由网关」设计方案对本项目（ST-Quicker-Api / st-api-router）是否有帮助、哪些部分值得吸收、哪些必须拒绝，以及下一步具体做什么。
> 状态：**评审完成，未写实现代码**（本文件是可执行的交接文档）。

---

## 0. 一句话结论

**有帮助，但帮助不是「照搬网关」——而是帮我们确认了一件我们自己的设计稿已经写明、却还没落地的事：把熔断粒度从 Vendor 级下沉到 Key(GroupEntry) × 模型级。** 外部文档里 80% 的内容（PostgreSQL/Redis/服务端网关/OpenAI 兼容适配层/管理 API）与我们的架构约束冲突，应当拒绝；但它给出的「错误分类 → 指数退避 → 半开用真实流量验证 → 请求自动切换候选」这套方法论，正是我们 `docs/PER_MODEL_HEALTH_DESIGN.md` 的设计内容，而那篇设计稿目前**尚未在代码中实现**。这是我们当前最有价值的下一步。

---

## 1. 本项目是什么（30 秒回顾）

- **定位**：SillyTavern 扩展（`manifest.json` → `dist/index.js`），按「逻辑模型」在多个 Vendor + Key 之间路由聊天 API 请求。
- **核心约束（不可违反）**：
  1. **不能主动测试**：不对 vendor 发连接测试、不调 `/models` 探测，全部健康状态来自真实业务流量（`GENERATION_STARTED/ENDED/STOPPED` + toastr 失败观察）。
  2. **不能引入服务端**：没有 PostgreSQL / Redis / 独立网关进程；状态全部存在 ST 设置 JSON（`src/settings`、`src/state`）。
  3. **不代理请求**：由 SillyTavern 原生发请求，插件只「改写连接字段」（`patchGenerateData` 拦截模式）；失败由 ST 原生反馈，插件只"读"。
  4. **运行环境简陋**：纯浏览器扩展 JS，无 Node 服务运行时。
- **分层模型**：`Vendor（模型商，全局，RPM/上下文限制/健康状态 Vendor 级）→ Group（使用环境）→ GroupEntry（Key，挂 vendorId+apiKey）→ mappings（realModel → logicalModelId）`。模型元数据按 Key 级存放（不同 Key 可能拉到不同模型）。

---

## 2. 外部设计文档 vs 本项目：逐块对照

外部文档结构（聚合网关：数据模型 → 路由决策 → 故障检测 → 模型映射 → 并发 → 实现建议 → 日志）与本项目概念逐个映射如下。

### 2.1 概念映射表（哪些概念我们本来就有）

| 外部设计概念 | 本项目对应物 | 状态 |
|---|---|---|
| vendor（供应商） | `Vendor`（`src/domain/vendor.ts`） | ✅ 已有 |
| channel / key | `GroupEntry`（Group 条目，即 Key） | ✅ 已有 |
| channel_model（最小可用单元） | 概念上没有专表；key 粒度 = `GroupEntry`，模型粒度 = `entry.mappings[].realModel` | ⚠️ 模型粒度健康字段**未实现**（见 §3） |
| public_model / upstream_model（映射） | `logicalModelId`（对外逻辑模型）→ `mapping.realModel`（上游真实模型） | ✅ 已有 |
| group_name（分组） | `Group`（使用环境）+ `entry.label`；无 fast/cheap 分组偏好排序 | ⚠️ 无分组偏好（可选增强） |
| priority / weight | `vendor.weight` + `vendorEffectiveWeight`（成功率加权） | ✅ 已有（Vendor 级） |
| 熔断状态机 healthy/cooldown/half_open/disabled | 旧 Provider 层：`key.circuits[model]`、`key.failStreakByModel`；新 Group 层：只有 `vendor.enabled` | ⚠️ 新层退化，见 §3 |
| 错误分类（fatal/rate_limited/temp/bad_request） | `PER_MODEL_HEALTH_DESIGN.md` §4.1 `classifyModelFailureMessage`（设计稿，未实现） | ⚠️ 未实现 |
| 自动切换候选 / 重试 | 我们**刻意不做自动重发**（旧设计 `ROUTING_REDESIGN.md`：失败不自动重发，明确失败）；`stickyCount` 只做「按次复用上次选中」 | ❌ 有意不同 |
| 请求日志表 / 状态变更日志 | 无持久化日志表；只有 UI 侧诊断字段（`lastError`、`successes/failures`） | ⚠️ 无（轻量替代见 §4） |
| PostgreSQL / Redis / Fastify 服务 / 管理 API | —— | ❌ 与约束 2/3/4 冲突，拒绝 |

### 2.2 外部文档里**值得吸收**的要点（对应我们自己的设计稿）

外部文档第 2、5 篇章（零主动测试版）的核心方法论，我们自己的 `docs/PER_MODEL_HEALTH_DESIGN.md` 已经完整覆盖并针对本插件架构做了落地设计：

1. **最小禁用粒度 = Key × realModel**（外部「渠道+模型」原则）→ 我们：`circuitsByModel` 挂 `GroupEntry`，key 为 `mapping.realModel`。同 Key 不同模型独立冷却。
2. **不主动测试，真实请求即探针** → 我们：`FailureObserver` 观察 toastr 判定成败，`GENERATION_ENDED` 记账；半开用下一次真实请求验证。
3. **错误分类**：`fatal`（模型不存在/余额/401/403 → 立即长冷却 6h）、`rate_limited`（429 → 短冷却 30s 不累计）、`bad_request`（参数错误不处理）、`temp/unknown`（累计连续失败达阈值冷却）。
4. **指数退避 + 上限**：`base * multiplier`，`multiplier 1→2→4→…→32`，成功/半开成功归 1。
5. **冷却到期 → 半开 → 真实流量验证**：我们首期约定「冷却到期即恢复可路由，下次真实请求自然验证」（不做并发闸门，二期可加）。
6. **阈值建议**：`failThreshold=2`、`baseCooldown=现有 cooldownSeconds(默认60s)`、`fatal=6h`、`429=30s`、`maxMultiplier=32`。

> 结论：外部文档的「方法论层」= 我们设计稿的内容；**不用再引入新的外部理念**，直接把 `PER_MODEL_HEALTH_DESIGN.md` 落地即可（它就是把旧 Provider 层已验证的 `key×model` 熔断模式搬进新 Group 层的方案）。

### 2.3 外部文档里**必须拒绝**的部分（与约束冲突）

| 外部建议 | 冲突点 | 处置 |
|---|---|---|
| new-api / one-api 现成网关 | 违反「ST 原生发请求（指纹）」「不引入中转层」 | ❌ 已有明确结论（`ROUTING_REDESIGN.md` 背景） |
| Go/Python/FastAPI 自建网关 + Postgres + Redis | 违反约束 2/3/4（无服务端、不代理请求） | ❌ |
| 主动健康检查（定时 `/v1/models` 或最小 chat） | 违反约束 1（不能主动测试/探测） | ❌ |
| 请求日志表 / 审计表 / 分区保留 | 无 Postgres；设置 JSON 不适合高频日志 | ❌（轻量替代：诊断字段 + 现有 successes/failures 计数） |
| 并发控制（max_concurrency、信号量） | 我们由 ST 原生发请求，插件不持有连接；且单用户场景意义小 | ❌（可列为远期可选，不阻塞） |
| 滑动窗口错误率（>50% & ≥5） | 设计稿明确一期不做（复杂度高、收益边际） | ⏸ 二期 |
| half_open 并发闸门（限 1 并发） | 设计稿明确首期不做（冷却到期即恢复，真实流量验证） | ⏸ 二期 |

---

## 3. 关键发现：gap 在哪里（这是本次评审最重要的产出）

### 3.1 现状（代码实际状态）

- **新路由链路（当前生效）是 Vendor 级熔断**：
  - `src/routing/hooks.ts` `onGenerationEnded`：`recordVendorFailure(vendor, …)` → 连续失败达 `failThreshold` → `vendor.enabled = false`（禁用整个 Vendor）。
  - `src/domain/vendor.ts` `recordVendorFailure`（591 行起）：`vendor.failStreak >= threshold → vendor.enabled=false`。
  - `src/domain/group-routing.ts` `groupUnitUnavailabilityReason`（40 行起）：只查 `vendor.enabled` / `entry.enabled` / RPM，**没有模型级检查**。
- **后果（正是外部文档警告的误伤场景）**：Vendor B 同时承载 `gpt-4o` 与 `gemini-pro`，`gemini-pro` 连挂会把整个 Vendor B 禁掉，`gpt-4o` 无辜受损。
- **讽刺的是，旧 Provider 层本来就有正确答案**：
  - `src/types.ts` `ProviderKey` 有 `circuits: Record<model, until>`、`failStreakByModel: Record<model, number>`。
  - `src/domain/routing.ts`:100-120 有 `key×model` 级熔断记账（`recordFailure` / 清熔断）。
  - 新 Vendor/Group 层迁移时**把这个能力弄丢了**，退回 Vendor 级。

### 3.2 设计稿存在但未实现

`docs/PER_MODEL_HEALTH_DESIGN.md`（347 行，完整可落地设计）明确要做的 5 步，**代码里一样都没有**：

| 设计稿要求 | 代码现状 |
|---|---|
| `types.ts` 的 `GroupEntry` 加 `failStreakByModel/circuitsByModel/lastErrorKindByModel/cooldownMultiplierByModel/lastErrorByRealModel` + `ModelFailureKind` 类型 | ❌ 只有旧 `ProviderKey` 上有；`GroupEntry` 上没有；`ModelFailureKind` 不存在 |
| `vendor.ts` `normalizeGroupEntry` 归一化新字段 + `resetGroupRuntimeState` | ❌ 不存在 |
| 新增 `src/domain/model-health.ts`（`classifyModelFailureMessage`/`recordModelSuccess`/`recordModelFailure`） | ❌ 文件不存在（Test-Path=False） |
| `group-routing.ts` 加 `modelUnitUnavailabilityReason`（模型冷却过滤） | ❌ 不存在 |
| `failure-observer.ts` `end()` 返回 `FailureProbe {kind, message}`（非 boolean） | ❌ 仍返回 `boolean` |
| `hooks.ts` `onGenerationEnded` 改模型级记账 | ❌ 仍是 `recordVendorFailure` |
| `SCHEMA_VERSION` 12 → 13 + 迁移测试 | ❌ 未动 |

---

## 4. 建议的下一步（按优先级）

### P0（核心交付，独立可完成）：按 `PER_MODEL_HEALTH_DESIGN.md` 落地模型级熔断

完全按现有设计稿执行，顺序即设计稿 §9：

1. `src/types.ts`：`GroupEntry` 追加 5 个运行时健康字段 + 定义 `ModelFailureKind`。
2. `src/domain/vendor.ts`：`normalizeGroupEntry` 补默认值；新增 `resetGroupRuntimeState(groups)`；`src/settings/initialize.ts` 在 `resetVendorRuntimeState` 旁调用；`SCHEMA_VERSION` 12→13（迁移安全，旧数据走 normalize 默认补全）。
3. 新增 `src/domain/model-health.ts`：分类 + 成功/失败记账 + 指数退避（常量复用 `RoutingSettings.failThreshold/cooldownSeconds`；fatal 6h、rate_limit 30s、cap ×32）。
4. `src/domain/group-routing.ts`：`groupUnitUnavailabilityReason` 末尾追加 `modelUnitUnavailabilityReason`（`circuitsByModel[realModel]` 未过期 → 返回 `'cooldown'`）。
5. `src/routing/failure-observer.ts`：`end()` 返回 `FailureProbe | null`（带上 `kind` 与截断消息）。
6. `src/routing/hooks.ts`：`onGenerationEnded` 改成 `recordModelSuccess/recordModelFailure`（按 `entry×realModel` 记账）；`recordVendorFailure` 降级为可选兜底或一期移除。
7. 测试：新增 `tests/model-health.test.ts`、`tests/group-routing-health.test.ts`、`tests/failure-observer.test.ts`；跑 `npm test`（现有全部测试保持全绿）、`npm run typecheck`、`npm run build`。

### P1（轻量替代日志/告警，可选）

- 不做请求日志表；在现有诊断基础上补「最近一次失败消息 + 冷却剩余」展示（`PER_MODEL_HEALTH_DESIGN.md` §6 UI）。
- 「某逻辑模型全候选不可用」时 toastr/提醒（相当于外部文档的告警，但零服务端）。

### P2（远期可选项，参考外部文档但不必急）

- 分组偏好排序（fast/cheap/default，在 Group 或 routing rule 上加 groupFilter）。
- half_open 并发闸门、滑动窗口错误率。

### 明确不做（与约束冲突，勿引入）

- new-api/one-api、自建网关、Postgres/Redis、主动探测、请求日志库表、并发信号量。

---

## 5. 给接手 agent 的 checklist

- [ ] 读 `docs/PER_MODEL_HEALTH_DESIGN.md`（完整落地设计，本交接就是它的执行令）。
- [ ] 读 `src/domain/routing.ts` 旧 Provider 的 `recordFailure`/`isModelCircuitOpen`（已验证模式，照搬语义）。
- [ ] 按 §4 P0 的 6 步落地，先类型后纯函数再接线，每步保持 `npm test` 全绿。
- [ ] `SCHEMA_VERSION` 升级 + `normalizeGroupEntry` 默认补全，保证旧设置 JSON 无损迁移。
- [ ] 不要引入任何服务端/主动测试；半开用真实流量验证。
- [ ] 完成后更新 `docs/ROUTING_REDESIGN.md`「已知差异」段与 `docs/README.md` 功能清单（把「失败自动禁用 Vendor」改为「Key×模型级熔断 + 指数退避 + 真实流量半开恢复」）。

---

## 6. 参考文件索引

- 外部评审对象：用户粘贴的「聚合路由网关」多轮设计（不再重复粘贴，结论见 §2）。
- 本项目落地设计：`docs/PER_MODEL_HEALTH_DESIGN.md`
- 本项目路由重设计背景：`docs/ROUTING_REDESIGN.md`
- 调用链/事件流：`docs/CALL_CHAIN.md`
- 现状代码：`src/domain/group-routing.ts`、`src/domain/vendor.ts`（`recordVendorFailure`）、`src/routing/hooks.ts`、`src/routing/failure-observer.ts`、`src/types.ts`（旧 `ProviderKey.circuits/failStreakByModel`）