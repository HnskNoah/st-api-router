# 分层随机路由设计：Vendor → 渠道

> 状态：已实施。
>
> 实现：`src/types.ts`、`src/domain/vendor.ts`、`src/domain/group-routing.ts`、`src/routing/manual-route.ts`、`src/routing/ui/right-mapping.ts`、`src/routing/ui/right-vendor.ts`、`src/routing/ui/right-route.ts`、`src/routing/ui/route-detail.ts`；回归测试位于 `tests/`。
>
> 目标：在同一 Vendor 下存在多个真实模型/渠道、且各自可用性不同的情况下，避免一个模型故障误伤同 Vendor 的其他模型，同时保留 Vendor 级整体偏好。

## 1. 任务契约

### 背景

当前路由候选粒度已经是：

```text
Vendor + GroupEntry(Key) + VendorModelMapping(真实模型)
```

但当前随机权重只挂在 Vendor 上。直接把所有候选放进同一个加权池，会产生两个问题：

1. 同一 Vendor 下候选数量越多，该 Vendor 的总体概率可能被无意放大。
2. Vendor 下某个真实模型的可用性、限流或故障状态不同，单层随机难以表达“先选服务商，再选具体渠道”的策略。

当前健康状态已经按 `GroupEntry(Key) × realModel` 记录，适合继续作为候选过滤依据。

### 目标

实现两阶段路由：

1. 在当前逻辑模型的可用 Vendor 中按 Vendor 权重选择 Vendor。
2. 在选中的 Vendor 内，按 Key/真实模型渠道权重选择一个可用路由单元。

最终路由单元仍为：

```text
Vendor + GroupEntry(Key) + VendorModelMapping(真实模型)
```

### 范围

允许修改：

- `src/types.ts`
- `src/domain/vendor.ts`
- `src/domain/group-routing.ts`
- `src/domain/model-health.ts`（仅在需要补充选择状态/健康接口时）
- `src/routing/hooks.ts`
- `src/routing/fallback.ts`
- `src/routing/manual-route.ts`
- `src/routing/ui/console-helpers.ts`
- `src/routing/ui/route-detail.ts`
- `src/routing/ui/right-vendor.ts`
- `src/routing/ui/right-route.ts`
- `src/constants.ts`
- 对应 `tests/**/*.test.ts`
- 本设计稿及相关文档

### 非目标

本阶段不做：

- 不引入服务端、数据库、Redis、网关或代理层。
- 不主动测试 Vendor，不新增 `/v1/models` 轮询，不发送最小 chat。
- 不自动重发失败请求。
- 不把模型级故障升级为整个 Vendor 自动禁用。
- 不改变 SillyTavern 原生请求发送方式。
- 不改变逻辑模型参数的透传语义。
- 不新增基于滑动窗口错误率的复杂熔断；首期继续使用现有连续失败和冷却机制。

### 硬约束

- 健康状态仍只来自真实业务流量。
- `Vendor.rpm` 仍是 Vendor 全局限流，所有 Group/Key 共享。
- `GroupEntry × realModel` 冷却只排除对应渠道。
- 不在路由过程中触发 `source` 的 `change` 事件。
- 相对 import 保留 `.js` 后缀，纯函数继续放在 `domain/`。
- 迁移必须兼容旧配置：新增权重默认 `1`，旧配置无需手工修改。

## 2. 当前行为基线

- `Vendor.weight` 是 Vendor 基础权重。
- `vendorEffectiveWeight()` 根据 Vendor 历史成功/失败统计调整 Vendor 权重。
- `groupUnitsForLogicalModel()` 返回当前 Group 下全部匹配映射的路由单元。
- `candidateGroupUnits()` 过滤 Vendor、Key、RPM 和 `Key × realModel` 冷却。
- `pickGroupUnit()` 先按 Vendor 分组选择，再在选中的 Vendor 内按 Key × 映射权重选择。
- `groupUnitKey()` 使用 `vendorId::entryId::mappingId`，区分同一 Key 下的不同真实模型。

当前实现已经完成本设计的两阶段路由、权重、健康隔离和 sticky 粒度调整。

## 3. 数据模型

### 3.1 Vendor 权重

保留现有字段：

```ts
Vendor.weight: number
```

语义：Vendor 级整体偏好。数值越大，在多个 Vendor 都有可用渠道时，获得的 Vendor 选择概率越高。

Vendor 成功率加成继续保留：

```text
vendorScore = Vendor.weight × vendorEffectiveHealthFactor
```

`vendorEffectiveHealthFactor` 沿用现有 `vendorEffectiveWeight()` 的成功率逻辑，避免无必要改变历史行为。

### 3.2 Key 权重

在 `GroupEntry` 新增：

```ts
weight: number
```

默认值：`1`。

语义：同一 Vendor 内，不同 Key 的渠道偏好。只影响当前 Group 中该 Key 的候选概率，不改变 Vendor 总体被选概率。

### 3.3 真实模型映射权重

在 `VendorModelMapping` 新增：

```ts
weight: number
```

默认值：`1`。

语义：同一 Key 承载多个真实模型时，各真实模型/渠道的相对偏好。

### 3.4 渠道权重

对于一个路由单元：

```text
channelScore = GroupEntry.weight × VendorModelMapping.weight
```

首期不增加额外的动态健康乘数；健康通过候选过滤表达：冷却中的单元直接不进入选择池。

这样可以避免成功率同时在 Vendor 层和模型层重复放大，导致概率难以解释。

### 3.5 归一化和迁移

`normalizeGroupEntry()`：

- `weight` 转为有限非负数。
- `weight <= 0` 时使用 `1`。
- 建议保留小数，便于 `0.5`、`2.5` 这种比例。

`normalizeVendorModelMapping()`：

- `weight` 转为有限非负数。
- `weight <= 0` 时使用 `1`。

旧配置没有字段时自动得到 `1`。不新增一次性复杂迁移。

### 3.6 模型名称归类与手动修正


模型归类不会改写真实模型名。`VendorModelMapping.realModel` 始终保存并用于请求原名。

自动归类顺序：

1. 逻辑模型 `matchPattern` 正则。
2. 真实模型名完整匹配。
3. 用已有逻辑模型名作为后缀进行最长匹配，识别不定长渠道前缀，例如 `供应商A-gemini-3.5-flash` → `gemini-3.5-flash`。
4. 内置核心名归一化。
5. 无法确认时创建独立逻辑模型。

最长后缀策略不会把正常模型变体误当成渠道前缀。例如已有 `gemini-3.5-flash` 时，`gemini-3.5-flash-lite` 仍保持独立。

版本分隔符不同也不会默认合并。例如 `claude-opus-4-7` 与 `claude-opus-4.7` 默认是两个真实模型；需要在映射面板配置显式正则，例如：

```regex
^claude-opus-4(?:-|\\.)7$
```

对于自动归类遗漏的真实模型，映射面板的“未归类真实模型”区域支持选择目标逻辑模型并手动映射。该操作只修改映射归属，不修改真实模型名，并对所有包含该模型的 Key 生效。

### 4.1 构造可用渠道

输入：

```text
vendors
activeGroup
logicalModelId
now
```

先由现有 `groupUnitsForLogicalModel()` 找到所有映射单元，再用现有可用性判断过滤：

```text
Vendor.enabled !== false
Entry.enabled !== false
Vendor RPM 未耗尽
Entry × realModel 不在冷却
```

得到：

```ts
availableUnits: GroupRouteUnit[]
```

无可用单元时，沿用现有原因汇总，不自动重发。

### 4.2 按 Vendor 分组

按 `vendor.id` 分组：

```text
Vendor A:
  Key A1 / model-1
  Key A1 / model-2
  Key A2 / model-1

Vendor B:
  Key B1 / model-1
```

一个 Vendor 只要至少有一个可用单元，就进入 Vendor 候选池。

### 4.3 第一阶段：选择 Vendor

每个 Vendor 的选择权重：

```text
vendorSelectionWeight = vendorEffectiveWeight(vendor)
```

只在至少有一个可用渠道的 Vendor 之间做加权随机。

重要语义：

- Vendor 下有 1 个还是 10 个可用模型，不改变 Vendor 的第一阶段总体权重。
- 某个 Vendor 的部分模型冷却，只要仍有其他可用模型，该 Vendor 继续参与。
- Vendor 下全部渠道不可用时，Vendor 从第一阶段候选中移除。

### 4.4 第二阶段：选择渠道

在已选 Vendor 的可用单元内，按：

```text
channelSelectionWeight = entry.weight × mapping.weight
```

进行加权随机。

结果是一个明确的：

```text
Vendor + Key + realModel
```

随后沿用现有流程：

- 记录 Vendor RPM。
- 确保 custom Vendor 的 secretId。
- 写入真实模型名。
- 读取目标逻辑模型的 include/exclude/header 参数。
- 由 ST 原生发送请求。

### 4.5 概率示例

配置：

```text
Vendor A.weight = 3
Vendor B.weight = 1
```

两者都有可用渠道时：

```text
Vendor A ≈ 75%
Vendor B ≈ 25%
```

Vendor A 内：

```text
Key A1.weight = 1
  model-1.mapping.weight = 3
  model-2.mapping.weight = 1

Key A2.weight = 2
  model-1.mapping.weight = 1
```

渠道权重为：

```text
A1/model-1 = 3
A1/model-2 = 1
A2/model-1 = 2
```

Vendor A 内的相对概率为：

```text
A1/model-1 = 50%
A1/model-2 ≈ 16.7%
A2/model-1 ≈ 33.3%
```

如果 `A1/model-2` 冷却，它被移出候选池，剩余渠道重新归一化为：

```text
A1/model-1 = 60%
A2/model-1 = 40%
```

Vendor A 的总体 75% 偏好不因此被取消，只是 Vendor A 内部改选其他可用渠道。

## 5. Sticky 修正

### 5.1 当前问题

当前 `groupUnitKey()` 返回：

```text
vendorId::entryId
```

同一 Key 下多个真实模型会被视为同一个 sticky 单元，可能造成：

- 上一次实际选中 `model-1`，下一次 sticky 只锁定到 Key，但重新选择时无法表达真实模型身份。
- 同一 Key 下模型级冷却变化时，sticky 语义不明确。

### 5.2 新标识

改为包含映射身份：

```text
vendorId::entryId::mappingId
```

若历史数据中 mapping id 不稳定，则使用：

```text
vendorId::entryId::realModel
```

推荐优先使用 `mapping.id`，并在测试中保证同一 Key 下不同真实模型得到不同 unit key。

### 5.3 Sticky 可用性

复用 sticky 前必须重新检查该完整路由单元：

- Vendor 仍启用。
- Key 仍启用。
- Vendor RPM 仍有余量。
- 该 Key × 真实模型未冷却。
- 映射仍存在于当前 Group。

任一条件不满足，放弃 sticky，重新执行两阶段选择。

## 6. 健康与错误隔离

健康粒度保持：

```text
GroupEntry(Key) × realModel
```

行为：

| 事件 | 影响范围 |
|---|---|
| `model-1` 在 Key A 上 fatal | 只冷却 Key A × model-1 |
| Key A 的 model-2 成功 | 不受 model-1 冷却影响 |
| Vendor A 的 Key B 上 model-1 失败 | 不影响 Key A × model-1 |
| Vendor A 所有渠道都冷却 | Vendor A 暂时没有候选，但不自动改 `enabled` |
| Vendor A RPM 达上限 | Vendor A 当前请求周期不参与选择 |
| 真实业务成功 | 只恢复实际被选中的 Key × realModel |

Vendor 成功/失败统计仍可用于 Vendor 级权重展示和 `vendorEffectiveWeight()`，但不能把单个模型的错误升级为 Vendor 禁用。

## 7. UI 设计

### Vendor 编辑

保留 Vendor `weight`，文案明确：

```text
Vendor 权重：控制该 Vendor 整体被选中的概率
```

### Key 编辑

在 Key 行或 Key 编辑器增加：

```text
Key 权重：控制同一 Vendor 内该 Key 的相对概率
```

### 路由详情

每个 `Vendor · Key · RealModel` 路由单元显示：

- Vendor
- Key
- 真实模型
- 当前状态：可用/冷却/禁用
- Vendor 权重
- Key 权重
- 真实模型映射权重
- 渠道相对权重（可选显示）

### 真实模型映射编辑

允许在逻辑模型的路由详情或映射管理区修改某条 `VendorModelMapping.weight`。

首期可先提供 Key 权重和数据层支持，映射权重 UI 若复杂则作为同一版本的后续小步，但路由算法必须从第一天支持默认值 `1`。

## 8. 实施步骤

### Step 1：数据结构和归一化

修改：

- `src/types.ts`
- `src/domain/vendor.ts`
- `src/constants.ts`（仅当 schema 版本需要调整）
- `src/settings/initialize.ts`（仅当需要增量迁移）

输出：

- 新配置字段定义。
- 旧配置归一化后权重均为 `1`。
- 导入/导出保留新权重字段。

验证：

- 旧配置 fixture 不变且可加载。
- `0`、负数、字符串、空值都归一化为 `1`。
- 小数权重保留。

### Step 2：两阶段纯函数路由

修改：

- `src/domain/group-routing.ts`
- 必要时 `src/domain/vendor.ts`

输出：

- `groupUnitsForLogicalModel()` 保持返回全部映射单元。
- 新增 Vendor 分组和两阶段选择纯函数。
- Vendor 总体概率不受该 Vendor 候选数量影响。
- Vendor 内按 `entry.weight × mapping.weight` 选择渠道。

验证：

- 单 Vendor 多 Key、多模型的概率边界。
- 多 Vendor 候选数量不同但 Vendor 权重相同/不同的概率语义。
- 冷却一个模型后其他模型仍可选。
- Vendor 全部渠道不可用后不进入 Vendor 候选池。

### Step 3：Sticky 粒度修正

修改：

- `src/domain/group-routing.ts`
- 相关 routing tests

输出：

- sticky key 包含映射身份。
- 同 Key 不同真实模型不会互相复用 sticky。
- 冷却/删除后自动放弃旧 sticky。

验证：

- 同 Key 两个真实模型产生不同 unit key。
- sticky 复用完整 Vendor + Key + realModel。
- 旧 sticky 指向不可用单元时重新选路。

### Step 4：接线和旁路路径

修改：

- `src/routing/hooks.ts`
- `src/routing/fallback.ts`
- `src/routing/manual-route.ts`

输出：

- 正常生成和 fallback 都使用同一两阶段决策。
- 手动路由仍可锁定完整 Vendor + Key + realModel。
- RPM 只在最终选定单元后记录一次。

验证：

- 正常生成和独立流选择语义一致。
- 手动锁定不被随机路由覆盖。
- 用户停止生成仍正确回滚 RPM。

### Step 5：UI 和文档

修改：

- `src/routing/ui/right-vendor.ts`
- `src/routing/ui/route-detail.ts`
- `src/routing/ui/right-route.ts`
- 相关 CSS/文档

输出：

- Vendor/Key/映射权重可见、可编辑。
- 路由详情展示最终渠道及权重。
- 文案区分 Vendor 权重、Key 权重、真实模型权重。

验证：

- 编辑后持久化并重新打开仍保持。
- 不影响 Key 拉取模型、映射和逻辑模型选择。
- 桌面/手机控制台均可查看最终路由单元。

### Step 6：集成验证和发布

执行：

```bash
npm test
npm run typecheck
npm run build
```

然后在实际 SillyTavern 页面验证：

- 多 Vendor、多 Key、多真实模型的概率行为。
- 某个渠道冷却后同 Vendor 其他渠道仍能路由。
- 逻辑模型附加参数仍按目标逻辑模型透传。
- 正常路径和 fallback 路径均不触发主动模型探测。

## 9. 验收标准

必须同时满足：

1. 同一 Vendor 下任意一个真实模型故障，不会排除该 Vendor 的其他可用真实模型。
2. Vendor 第一阶段概率只由 Vendor 权重和 Vendor 级历史因子决定，不由候选模型数量隐式放大。
3. Vendor 内渠道概率由 Key 权重和映射权重决定。
4. 旧配置无新字段时行为等价于默认权重 `1` 的两阶段方案。
5. `Key × realModel` 冷却仍然独立，冷却一个渠道不会影响同 Key 其他模型。
6. sticky 能区分同一 Key 下不同真实模型，并在渠道失效时自动放弃。
7. 正常生成、fallback、手动路由三条路径都使用完整的 `Vendor + Key + realModel` 身份。
8. 逻辑模型的 exclude/include 参数仍只由目标逻辑模型决定，并在 custom 源请求中透传。
9. 不新增主动探测、不代理请求、不自动重发。
10. 全量测试、类型检查、生产构建均通过。

## 10. 回滚路径

如果两阶段算法在真实环境中表现异常：

1. 保留新增权重字段，但将默认路由策略切回旧 `pickGroupUnit()`。
2. 通过一个内部策略常量或版本化设置开关禁用两阶段选择，不删除已保存权重。
3. sticky key 的格式变更必须向后兼容：旧 sticky 无映射身份时视为不可复用，下一次请求重新随机。
4. 不回滚健康字段和现有模型映射数据。

回滚后再次启用时，用户已经配置的 Vendor/Key/映射权重仍可直接使用。

## 11. 残余风险

- 随机概率需要长样本观察，单次或短时间窗口不能证明精确比例。
- Vendor 历史成功率因子与 Vendor 手动权重相乘，仍可能让用户对绝对概率产生误解；UI 应展示相对权重而非承诺精确百分比。
- Key 权重和映射权重同时存在时，运维人员需要理解乘法关系；详情页必须显示最终渠道权重。
- 同一真实模型在多个 Key 上的健康状态独立，这是设计目标，但会让“模型整体健康”不能用单一状态表示。
