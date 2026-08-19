
## 背景与目标

用户手上有多家模型商（Vendor）的多个 Key，各 Vendor 提供的模型名不统一，且不同 Vendor 的限制不同。

核心需求：

- 不使用 new-api 等中转层，必须由 SillyTavern 原生发送请求，保证请求带有 SillyTavern 指纹。
- 在 Group 内选择逻辑模型，插件在每次生成前从可用 Vendor 中随机选一个真实模型并改写 ST 原生连接字段。
- 选到不可用的 Vendor 时明确失败，不自动重发。
- Vendor 连续失败自动禁用，之后由用户手动启用。
- 同一 Vendor 可以挂多个 Key，Key 粒度可继续细分访问权限。
- 模型获取频率与 SillyTavern 原生对齐：只在用户点 ST 的“获取模型”时跟着拉取，不做插件侧轮询。

## 核心概念

### Vendor（模型商）

Vendor 是全局配置，代表一家可提供模型的站点或服务商。

- `id`
- `name`
- `endpoint`
- `format`：Custom / Custom Responses / DeepSeek 等
- `rpm`：Vendor 全局限流，0 表示不限
- `maxContext`：prompt/context 上限，路由到该 Vendor 时钳制 ST 上下文
- `enabled`：用户手动启用/禁用；连续失败自动禁用后需要手动恢复
- `fetchedModels`：通过 ST 原生 `/models` 拉取到的真实模型名列表
- `mappings`：Vendor 级真实模型名 → 逻辑模型 id 的映射列表（`{ id, realModel, logicalModelId }`）
- 健康状态：`failStreak`、`lastError`、`disabledReason`

### Real Model（真实模型）

Vendor 提供的真实模型名，例如 `[xxx]grok-4.5`、`xxx-gemini-3-flash-preview`。

- 来自 Vendor 拉取的模型列表，原样保存、原样展示、原样发送
- 通过 Vendor 级映射归并到逻辑模型

### Logical Model（逻辑模型）

用户可见、可选择的模型，例如 `Grok 4.5`。

- 一个逻辑模型可由多个 Vendor 的真实模型映射而来
- 逻辑模型是路由选择入口，本身不直接持有 Key

### Group（功能分组）

Group 是全局使用环境，代表一套独立配置，可以理解为“当前使用的 API 环境”。

- `id`、`name`、`enabled`
- `currentLogicalModelId`：整个 Group 当前选中的逻辑模型 id
- `entries`：Vendor + Key 条目列表
  - `vendorId`
  - `apiKey`
  - `label`、`enabled`
  - 同一个 Vendor 可以在一个 Group 中挂多个 Key

Group 不挂在 Vendor 下；不同 Group 可以配置不同的 Vendor 和 Key。同一个 Vendor 在不同 Group 中出现时，共用该 Vendor 的配置、RPM、模型映射和健康状态。

## 关系图

```text
Vendor --提供(多对多)--> RealModel --多对一--> LogicalModel --属于(多对多)--> Group
                                                                    ↑
                                                   Group 条目 = Vendor + Key
```

`Vendor` 与 `RealModel` 多对多：同一 Vendor 提供多个真实模型，同一真实模型也可以被多个 Vendor 提供（名称不同时通过映射归并）。

`LogicalModel` 与 `Group` 多对多：一个逻辑模型可以在多个 Group 中可用；一个 Group 可以访问多个逻辑模型。

## 路由流程

用户在一个 Group 中选择逻辑模型后，每次生成前：

1. 根据当前 Group 的 `currentLogicalModelId`，找到所有能提供该逻辑模型的真实模型。
2. 从这些真实模型对应的 Vendor 中过滤：
   - Vendor 已启用
   - Vendor 未达到 RPM 全局限流
   - Vendor 有可用 Key
   - Vendor 未因连续失败被自动禁用
3. 按成功率权重做加权随机，选中一个 Vendor。
4. 从该 Vendor 在当前 Group 的条目中选一个可用 Key。
5. 改写 ST 原生连接字段：
   - `chat_completion_source`（按 Vendor format）
   - `custom_url` / `reverse_proxy`
   - `custom_model`（真实模型名）
   - Key 对应的 Secrets / 输入框
   - `max_context` 钳制到 Vendor `maxContext`
6. 由 ST 原生发送请求，插件不代理请求。

失败时不自动重发；本次失败记入 Vendor 健康状态，连续失败达到阈值后自动禁用整个 Vendor 并提示。

## 限流与健康状态

- RPM 为 Vendor 全局限流：同一 Vendor 的所有 Group、所有 Key 共享计数。
- 连续失败状态挂 Vendor：达到阈值后自动禁用 Vendor 的所有模型和所有 Group，并 toastr 提示。
- Vendor 被自动禁用后不自动恢复，由用户手动重新启用。
- 成功率权重：根据历史成功/失败情况自动调整，成功率高的 Vendor 获得更高概率被选中。

## 与当前实现的差异

当前代码已有 Provider / Key 雏形：

- `Provider` 类似 Vendor：有 endpoint、enabled、keys。
- `ProviderKey` 有 apiKey、fetchedModels、rpm、weight、enabled。
- `aggregateModels` 按 key 聚合模型。
- `routeOnce` 做候选过滤、加权随机、RPM、熔断。

需要调整的差异：

1. **RPM 从 Key 级改为 Vendor 级**：同一 Vendor 的所有 Key 共享限流窗口。
2. **连续失败从按 key × model 熔断改为 Vendor 级自动禁用**：达到阈值后 `provider.enabled = false`，手动恢复。
3. **新增 Vendor 级 `maxContext`**：路由时钳制 ST 上下文。
4. **新增 Vendor 级模型映射**：真实模型名 → 逻辑模型名。
5. **新增 Group 实体**：Group 持有条目（Vendor + Key）和当前逻辑模型，替代“Provider 下所有 Key 都参与路由”的模型。
6. **模型获取**：保留通过 ST 原生 `/models` 拉取，但由“当前连接”改为按 Vendor 拉取并落到 `vendor.fetchedModels`。
7. **UI 形态**：当前 Provider 路由面板升级为 Vendor / Model / Group 管理面板，旧 Profile 功能保留为兼容层。

## 实现顺序建议

1. 数据结构与迁移：新增 Vendor / Group 类型，保留旧 Provider 兼容迁移。
2. 纯函数路由引擎：Vendor 级 RPM、失败自动禁用、成功率权重、映射归并。
3. ST 原生交互：按 Vendor 拉取模型、路由时改写连接字段和 maxContext。
4. UI：Vendor 管理、Model 映射、Group 管理。
5. 事件接线：`GENERATION_STARTED / ENDED / STOPPED` 与失败观察。
6. 测试：覆盖映射、候选过滤、Vendor 限流、失败禁用、加权随机、Group 路由。

## 实现状态（当前）

> 最后更新：2026-08。以下描述基于代码实际状态，按模块逐一列出。

### 数据结构与迁移

- **已完成**（`src/domain/vendor.ts`，`schemaVersion` 12，旧 `providers[]` 一次性迁移到 `vendors[]/logicalModels[]/groups[]`，默认 Group「默认分组」）。
- 迁移入口：`src/settings/initialize.ts`，`schemaVersion <= 11` 时触发 `migrateProvidersToVendorModel`（`vendor.ts`），`normalizeGroupEntry` / `normalizeVendor` 提供默认值安全。
- `SCHEMA_VERSION` 在 `src/constants.ts` 定义，未来增量迁移只需 `storedVersion < SCHEMA_VERSION` 逐版本跳转。

### 纯函数路由引擎

- **已完成**（`src/domain/group-routing.ts`）：Vendor 级 RPM 窗口（`rpmWindow` / `vendorRpmAvailable`）、成功率加权选路（`vendorEffectiveWeight`）、候选过滤（`groupUnitUnavailabilityReason` 检查 `vendor.enabled` / `entry.enabled` / RPM）、失败原因汇总（`summarizeGroupUnavailable`）。支持 **sticky 按次复用**（`stickyCount` + `lastPicked`/`nextLastPicked`）。

### 路由旁路决策

- **兜底路由**（`src/routing/fallback.ts`）：独立请求流（MClite / JS-Slash-Runner 走 `generate()` 不触发 `GENERATION_STARTED`）时，`onChatCompletionSettingsReady` 无 active 路由，由 `resolveFallbackRoute` 按当前 Group 逻辑模型选路接管连接字段。不弹 token 钳制确认窗，避免卡死独立流。
- **手动路由锁定**（`src/routing/manual-route.ts` + `hooks.ts` `consumeManualLock`）：用户点击手动路由按钮后，锁定选中的 `Vendor + Key + realModel` 到下一次生成；下一次生成消费锁定并记录 RPM，之后恢复随机。分组切换或逻辑模型变化后旧锁定失效。手动锁定对兜底路由同样生效。

### 模型健康（Key × realModel 级熔断 — 当前实际行为）

- **Key × realModel 级**（`src/domain/model-health.ts`）：`recordModelFailure` 按 `GroupEntry(Key) × realModel` 粒度记账，区分 `fatal`（不可恢复→长冷却 6h）、`rate_limited`（限流→短冷却 30s 不累计）、`temp/unknown`（临时→累计连续失败达阈值冷却+指数退避 1→2→4→…→32）。`recordModelSuccess` 清除冷却，恢复健康。
- **路由过滤**（`src/domain/group-routing.ts` `modelUnitUnavailabilityReason`）：冷却中模型自动排除，同 Key 的其他模型不受影响。
- **Vendor 级统计**（`src/domain/vendor.ts`）：`successes/failures` 跨会话保留，仅用于 UI 展示和路由加权（`vendorEffectiveWeight`），不再触发 Vendor 级禁用。
- **失败观察**（`src/routing/failure-observer.ts`）：`end()` 返回 `FailureProbe { kind, message }`，供模型级记账使用。
- **接线**（`src/routing/hooks.ts` `onGenerationEnded`）：成功→`recordModelSuccess`，失败→`recordModelFailure`；Vendor 失败计数仅作统计用。

### maxContext 钳制

- **已完成**（`src/domain/context.ts`、`src/routing/apply-provider.ts`）：`computeVendorTokenClamps` 同时钳制 `openai_max_context` 和 `openai_max_tokens`，路由时弹窗确认后应用（`GENERATION_STARTED` 路径）；兜底路由路径跳过弹窗但不钳制。

### ST 原生接线

- **已完成**（`src/routing/hooks.ts` + `apply-provider.ts` + `patch-generate-data.ts`）：
  - `GENERATION_STARTED` → `runGenerationRouting` → 选路 + token 钳制弹窗 + 设 `state.active`。
  - `CHAT_COMPLETION_SETTINGS_READY` → 有 `active` → `patchGenerateData`（拦截模式改写 `chat_completion_source`/`reverse_proxy`/`proxy_password`/`model` 等字段）；无 `active` → `resolveFallbackRoute`（兜底路由）。
  - `GENERATION_ENDED` → `onGenerationEnded` → `recordModelFailure`/`recordVendorSuccess` + toastr 提示。
  - `GENERATION_STOPPED` → `onGenerationStopped` → RPM 回滚 + 标记 `userStopPending`（排除用户主动停止的误判）。
  - 跳过非用户触发生成（`quiet`/`continue`/`impersonate`）；`guard` 安全阻断（预设切换/密钥阻断）时跳过路由覆盖。
  - 对 `custom` format Vendor 自动 `ensureEntrySecret`（`src/secrets/api.ts`），确保 ST 自定义源能读到 key。

### 逻辑模型附加参数

- **已完成**（`hooks.ts` `customParamsForUnit`）：逻辑模型支持 `customIncludeBody`、`customExcludeBody`、`customIncludeHeaders`，在 `patchGenerateData` 时一并写入 `generateData`。适用于 Vendor 切换为 `custom` 源时附加自定义请求头/体。

### UI

- **路由控制台**（`src/routing/ui/console-panel.ts` + `src/routing/ui/console-panel-styles.ts` + `dashboard.ts` + `route-detail.ts` + `right-*.ts`）：新版三栏浮层面板，入口在 Quick Actions 菜单顶部（`openConsolePanel`）。左栏逻辑模型仪表盘（健康状态一览）、中栏路由详情（选中模型的所有可用路由及冷却状态）、右栏四 tab（设置 / Vendor 管理 / 路由 / 映射）。CSS 独立于 `console-panel-styles.ts`，各栏渲染独立于各 `render-*.ts`。
- **便捷按钮管理**（`src/quick-actions/manager.ts`）：管理界面（新增/编辑/删除/排序/复制），支持选择预设、模型（逻辑模型/聚合模型混合候选），配置入口位置（发送栏左/右侧、Quick Reply 按钮栏、禁用）。
- **快捷入口**（`src/quick-actions/runner.ts` + `menu.ts` + `menu-core.ts`）：发送栏左侧/右侧或 QR 按钮栏显示快捷按钮，点击后切换 preset + 模型（逻辑模型切换当前 Group 的 `currentLogicalModelId`，非逻辑模型回退写 `custom_model`）。
- **手动路由按钮**（`src/routing/manual-route-entry.ts`）：发送栏 `[🎲]`，锁定下一次生成路由到指定 Vendor/Key/Model。

### 模型管理

- **模型拉取**（`src/routing/ui/right-vendor.ts` + `right-route.ts`）：通过控制台"刷新模型"按钮按 Vendor 拉取，结果存入 `entry.fetchedModels`。
- **批量创建逻辑模型**（`src/domain/vendor.ts` `buildLogicalModelsFromFetched`）：从已拉取模型批量创建逻辑模型并自动映射（核心名匹配、统一小写）。
- **归并**（`src/routing/ui/right-route.ts`）：一键把某个逻辑模型合并到另一个。
- **模型判定**（`isRoutedModel`，`src/domain/vendor.ts`）：同时认新 Vendor 映射 realModel、逻辑模型 id/name。

### 便捷方案（Quick Actions）

- **已完成**（`src/quick-actions/` + `src/domain/quick-action.ts`）：支持预设 + 模型组合；模型字段支持逻辑模型/真实模型名。解析优先按逻辑模型 id/name（`resolveLogicalModelForAction`），非逻辑模型回退写 `custom_model`。编辑候选列表含逻辑模型名。

### 导入导出

- **导出**：控制台"路由"tab（`src/routing/ui/right-route.ts`）导出完整路由配置 JSON（含 Key，需妥善保管）。
- **模型列表导出**：txt 格式，不含密钥。

### 与最初设计文档的已知差异

- 实现用 `mappings` 字段（非 `modelMappings`/`modelRules`），逻辑模型选中存 `currentLogicalModelId`。
- Vendor 成功率权重存 `weight`（基础权重），实际选路权重 = `weight * (0.5 + successRate)`（`vendorEffectiveWeight`，`src/domain/vendor.ts`）。
- Group 条目为 `{ id, vendorId, apiKey, label, enabled, ... }`，含运行时健康字段（`failStreakByModel`、`circuitsByModel` 等），支持 **Key × realModel 级熔断**。
- 模型获取只通过路由面板的"拉取模型"按钮按 Vendor 拉取，未挂钩 ST 原生"获取模型"按钮（与初衷一致：不做插件轮询）。
- 模型级熔断已实现（`src/domain/model-health.ts`），冷却采用指数退避，半开用真实流量验证。
