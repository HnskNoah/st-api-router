# 过度设计与无用代码/测试排查记录

> 目的：记录对项目里「过度设计的代码」和「覆盖死代码的无用测试」的排查结论与处理。
> 最后更新：2026-08

---

## 结论速览

项目有两套并行的路由模型：
- **旧 Provider / Key / Profile 预设系统**（`src/domain/provider.ts`、`src/domain/routing.ts`、`src/domain/model-catalog.ts`、`src/profiles/`、`src/apply/`、`src/presets/`、`src/native/`、`src/models/`）
- **新 Vendor / Group 系统**（`src/domain/vendor.ts`、`src/domain/group-routing.ts`、`src/domain/model-health.ts`、`src/routing/*`）

**关键发现**：旧 Provider 的**路由引擎**（选路逻辑）已在运行时被彻底取代，是死代码；但其中**迁移函数**仍被 `settings/initialize.ts` 用于 v11→v12 数据迁移，仍会执行。

---

## 一、处理完成

### 已删除的无用测试

| 文件 | 原因 |
|---|---|
| `tests/routing.test.ts`（121 行，8 测试） | 整文件只测死路由引擎 `routeOnce`/`candidateUnits`/`recordFailure`/`isModelCircuitOpen` 等。新等价覆盖在 `tests/vendor-routing.test.ts` + `tests/group-routing-health.test.ts` + `tests/model-health.test.ts`。 |
| `tests/model-catalog.test.ts`（54 行，5 测试） | 大部分测死导出（`keyUnits`/`unitId`/`modelRegistry`/`unitsCarryingModel`/`modelsGroupedByKey`）。`aggregateModels` 的覆盖 trivial。（`isRoutedModel` 覆盖保留在 `tests/model-catalog-routed.test.ts`。） |

### 已删除的死代码

| 导出 | 位置 | 原因 |
|---|---|---|
| `recordVendorFailure` | `vendor.ts:659`（原位置） | 模型级熔断替换后无运行时 import。**同步清理了** `vendor-routing.test.ts` 中对应用例 + import。 |

### 已修复的导入导出漏改

| 问题 | 修复 |
|---|---|
| 导出 `sanitizeGroupForExport` 没清健康字段 | 新增 5 个 `delete`，跨机导出不再携带本机熔断/冷却/诊断状态 |
| 导入 `mergeImportedRoutingConfig` 未处理健康字段 | 新增 `dropImportedHealth` 辅助函数：已有条目丢弃导入值（保留本机）、新条目一律置空。新增 2 个回归测试覆盖 |
| 导入 `mergeImportedRoutingConfig` 新 group 分支没清 `secretId` | 新增 `entry.secretId = ''` 处理，与已有 group 分支一致 |

---

## 二、死导出清单（运行时无人 import，未删）

### `src/domain/routing.ts` — 旧路由引擎（15 个死导出）

| 导出 | 定义位置 | 运行时使用 |
|---|---|---|
| `routeOnce` | routing.ts:139 | ✗ |
| `candidateUnits` | routing.ts:68 | ✗ |
| `pickUnit` | routing.ts:77 | ✗ |
| `unavailabilityReason` | routing.ts:56 | ✗ |
| `summarizeUnavailable` | routing.ts:125 | ✗ |
| `isModelCircuitOpen` | routing.ts:37 | ✗ |
| `rpmWindow` / `rpmAvailable` | routing.ts:43 / 49 | ✗ |
| `recordSelection`/`recordSuccess`/`recordFailure` | routing.ts:89/97/105 | ✗ |
| `RPM_WINDOW_MS`/`FAIL_THRESHOLD_DEFAULT`/`COOLDOWN_MS_DEFAULT`/`STICKY_SECONDS_DEFAULT` | routing.ts:9-12 | ✗ |

> 唯一在用：`normalizeRoutingSettings`（`initialize.ts` + `routing/ui.ts`）。**保留**。

### `src/domain/model-catalog.ts` — 4 个死导出

| 导出 | 定义位置 | 运行时使用 |
|---|---|---|
| `keyUnits` / `unitId` | model-catalog.ts:8 / 19 | ✗ |
| `unitsCarryingModel` / `modelRegistry` | model-catalog.ts:24 / 29 | ✗ |
| `modelsGroupedByKey` | model-catalog.ts:71 | ✗ |

> 在用：`aggregateModels`（`quick-actions/manager.ts`）、`isRoutedModel`（`quick-actions/runner.ts`）。**保留**。

### `src/domain/provider.ts` — 3 个死常量

`PROVIDER_RPM_DEFAULT`、`PROVIDER_WEIGHT_DEFAULT`、`PROVIDER_FORMATS`（provider.ts:11-13）无运行时 import。
> 注意：`normalizeKey`/`normalizeProvider`/`normalizeProviders`/`providerFromProfile`/`resetRoutingRuntimeState` 虽无其他模块直接 import，但**通过 `initialize.ts` 的迁移路径可达**（v11→v12），仍在执行。**保留**。

---

## 三、保留的有用测试

| 文件 | 理由 |
|---|---|
| `tests/provider.test.ts` | 测仍运行的迁移代码（`normalizeProviders`/`providerFromProfile`/`resetRoutingRuntimeState`/`normalizeProviderFormat`），保护 v11→v12 迁移正确性 |
| `tests/domain.test.ts` | 测活跃的 Profile/quick-action/status 函数 |
| 其余 25 个测试文件 | 均覆盖正在使用的代码（新引擎 + 活的遗留系统） |

---

## 四、未处理的问题

### Vendor 成功率权重逐渐漂移（`vendorEffectiveWeight`）
`recordVendorFailure` 删除后，`vendor.failures` 不再被新失败递增（仅 `recordVendorSuccess` 递增 `successes`）。`vendorEffectiveWeight` 计算 `successes/(successes+failures)` 时，失败率分母冻结，成功率只升不降 → 权重随时间偏袒所有 Vendor。

**可能的修复**：在 `hooks.ts` 的失败分支（`onGenerationEnded` 失败时）也调用 `vendor.failures++`，保持 Vendor 成功率统计的完整性，但不触发 `vendor.enabled = false`。或者接受此行为——模型级冷却已取代 Vendor 级权重作为路由决策依据。

### 旧路由引擎死导出未删
`routing.ts` 的 `routeOnce`/`candidateUnits` 等 15 个导出 + `model-catalog.ts` 的 `keyUnits`/`unitId` 等 4 个导出 + `provider.ts` 的 3 个常量。不删的原因是它们和 `normalizeRoutingSettings`/`aggregateModels`/`normalizeProviders` 混在同一个文件里，拆分需要更多重构。建议后续清理。

---

## 五、验证状态

- `npm test`：✅ 27 文件 254 测试全绿
- `npm run typecheck`：✅ 通过
- `npm run build`：✅ 178 kB → `dist/index.js`