
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

## 实现状态（2025 快照）

- 数据结构与迁移：已完成（`src/domain/vendor.ts`，`schemaVersion` 12，旧 `providers[]` 一次性迁移到 `vendors[]/logicalModels[]/groups[]`，默认 Group「默认分组」）。
- 纯函数路由引擎：已完成（`src/domain/group-routing.ts`：Vendor 级 RPM 窗口、成功率加权选路、候选过滤、失败原因汇总）。
- Vendor 健康：连续失败自动禁用整个 Vendor（`recordVendorFailure`），手动启用才恢复；`successes/failures` 跨会话保留，`window/failStreak/lastError` 载入时重置。
- maxContext 钳制：`src/domain/context.ts` 纯函数 `clampContextLimit`，路由时钳制 ST `openai_max_context`。
- ST 原生接线：`src/routing/apply-provider.ts`（`applyVendorConnection` 改写 source/url/model/key 并钳制上下文）、`src/routing/hooks.ts`（GENERATION_STARTED/ENDED/STOPPED）。
- UI：路由面板升级为 Vendor / Group 管理（拉取模型自动映射、编辑、删除），旧 Profile 区折叠保留兼容入口（`src/routing/ui.ts`）。
- Quick Actions（便捷方案，快速切换模型）：按钮保留 preset/Profile 组合；模型字段支持逻辑模型——点击后只切换当前 Group 的 `currentLogicalModelId`（保存设置、刷新路由面板高亮，不立即写 ST 连接，下次生成由路由钩子选 Vendor/Key）。模型解析优先按逻辑模型 id/name（`src/domain/quick-action.ts` 的 `resolveLogicalModelForAction`），非逻辑模型时回退旧行为（路由真实模型写 custom_model，其余原生格式推断）。模型判定同时认旧 Provider 聚合模型、新 Vendor 映射 realModel、逻辑模型 id/name（`src/domain/model-catalog.ts` 的 `isRoutedModel`），编辑候选列表含逻辑模型名。
- 与文档的已知差异：
  - 实现用 `mappings` 字段（非 `modelMappings`/`modelRules`），逻辑模型选中存 `currentLogicalModelId`。
  - Vendor 成功率权重存 `weight`（基础权重），实际选路权重 = `weight * (0.5 + successRate)`（`vendorEffectiveWeight`）。
  - Group 条目为 `{ id, vendorId, apiKey, label, enabled }`。
  - 模型获取只通过路由面板的"拉取模型"按钮按 Vendor 拉取，未挂钩 ST 原生"获取模型"按钮（与文档第 14 行初衷一致：不做插件轮询）。
