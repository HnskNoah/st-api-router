# 过度设计与无用代码/测试排查记录

> 目的：记录对项目里「过度设计的代码」和「覆盖死代码的无用测试」的排查结论与处理。
> 最后更新：2026-08

---

## 结论速览

项目原有两套并行的路由模型，现已彻底清除旧系统：
- **旧 Provider / Key / Profile 预设系统**（`src/domain/provider.ts`、`src/domain/routing.ts`、`src/domain/model-catalog.ts`、`src/domain/profile.ts`、`src/domain/secrets.ts`、`src/domain/status.ts`、`src/profiles/`、`src/apply/`、`src/presets/`、`src/native/`、`src/models/`、`src/import/`、`src/popups.ts`、`src/events.ts`、`src/ui/render.ts`、`src/ui/toolbar.ts`）—— **已整体删除（Option C）**
- **旧路由面板**（`src/routing/ui.ts` + `src/routing/ui/{vendor-panel,logical-model-editor,model-list,mapping-tools,old-panel-styles}.ts`）—— **已删除**，被新三栏控制台取代
- **新 Vendor / Group 系统**（`src/domain/vendor.ts`、`src/domain/group-routing.ts`、`src/domain/model-health.ts`、`src/routing/*`、`src/routing/ui/console-*.ts`）—— 保留

**关键结果**：旧 Profile/Provider/预设系统的路由引擎、CRUD、数据迁移路径已全部删除，无数据迁移（旧遗留字段在 `settings/initialize.ts` 直接 `delete` 丢弃）。「切换 profile」能力由 Quick Actions 的 preset + 逻辑模型一键切换接管。

---

## 一、处理完成

### 已删除的无用测试

| 文件 | 原因 |
|---|---|
| `tests/routing.test.ts`（121 行，8 测试） | 整文件只测死路由引擎 `routeOnce`/`candidateUnits`/`recordFailure`/`isModelCircuitOpen` 等。新等价覆盖在 `tests/vendor-routing.test.ts` + `tests/group-routing-health.test.ts` + `tests/model-health.test.ts`。 |
| `tests/model-catalog.test.ts`（54 行，5 测试） | 大部分测死导出（`keyUnits`/`unitId`/`modelRegistry`/`unitsCarryingModel`/`modelsGroupedByKey`）。`aggregateModels` 的覆盖 trivial。（`isRoutedModel` 覆盖保留在 `tests/model-catalog-routed.test.ts`。） |

### 旧系统删除后同步清理的测试（Option C）

| 文件 | 处理 |
|---|---|
| `tests/provider.test.ts` | 删除了测已删 `domain/provider.ts` 的迁移函数用例，仅保留 `normalizeRoutingSettings`（constants.ts）覆盖 |
| `tests/domain.test.ts` | 删除了测已删 `domain/profile.ts`/`domain/status.ts` 的用例，仅保留 quick-action 函数覆盖 |
| `tests/vendor-routing.test.ts` | 删除了 `domain/vendor migration` 用例（`migrateProvidersToVendorModel` 已删） |
| `tests/secrets-clear.test.ts` | import 从 `domain/secrets.js` 改为纯模块 `secrets/clear.js`（`clearableQuickApiSecretIds`/`QUICK_API_SECRET_LABEL_PREFIX` 迁入） |

### 已删除的死代码（Option C）

| 项 | 位置 | 原因 |
|---|---|---|
| 整个旧 Profile/Provider/预设系统 | `src/profiles/`、`src/apply/`、`src/presets/`、`src/native/`、`src/models/`、`src/import/`、`src/ui/`、`src/popups.ts`、`src/events.ts` | 旧平行系统，功能由新 Vendor/Group 系统 + Quick Actions 接管 |
| `recordVendorFailure` | `vendor.ts` | 模型级熔断替换后无运行时 import |
| `migrateProvidersToVendorModel` | `vendor.ts` | v11→v12 迁移路径已删（无数据迁移），相关测试同步删除 |
| 旧路由面板 `routing/ui.ts` + 子模块 | `src/routing/ui/{vendor-panel,logical-model-editor,model-list,mapping-tools,old-panel-styles}.ts` | 被新三栏控制台完全取代（UI_REDESIGN 退役方向） |
| `idle` `applyProviderConnection` | `routing/apply-provider.ts` | 无调用者，且用到已删的 `Provider`/`ProviderKey` 类型 |
| `DEFAULT_SETTINGS` | `constants.ts` | 无消费者（initialize 不再合并默认值到旧字段） |

### 已修复的导入导出漏改

| 问题 | 修复 |
|---|---|
| 导出 `sanitizeGroupForExport` 没清健康字段 | 新增 5 个 `delete`，跨机导出不再携带本机熔断/冷却/诊断状态 |
| 导入 `mergeImportedRoutingConfig` 未处理健康字段 | 新增 `dropImportedHealth` 辅助函数：已有条目丢弃导入值（保留本机）、新条目一律置空。新增 2 个回归测试覆盖 |
| 导入 `mergeImportedRoutingConfig` 新 group 分支没清 `secretId` | 新增 `entry.secretId = ''` 处理，与已有 group 分支一致 |

---

## 二、死导出清单（运行时无人 import，未删）

> 旧 Provider/预设系统整体删除后，原清单中的死导出已随之消失。当前无已知死导出待清理。

---

## 三、保留的有用测试

| 文件 | 理由 |
|---|---|
| `tests/domain.test.ts` | 测活跃的 quick-action 函数 |
| `tests/vendor-routing.test.ts` | 测新 Vendor/Group 归一化 + 分组路由 |
| `tests/secrets-clear.test.ts` | 测 secret 标签清理纯函数 |
| 其余 25 个测试文件 | 均覆盖正在使用的代码 |

---

## 四、未处理的问题

### Vendor 成功率权重逐渐漂移（`vendorEffectiveWeight`）
`recordVendorFailure` 删除后，`vendor.failures` 不再被新失败递增（仅 `recordVendorSuccess` 递增 `successes`）。`vendorEffectiveWeight` 计算 `successes/(successes+failures)` 时，失败率分母冻结，成功率只升不降 → 权重随时间偏袒所有 Vendor。

**可能的修复**：在 `hooks.ts` 的失败分支（`onGenerationEnded` 失败时）也调用 `vendor.failures++`，保持 Vendor 成功率统计的完整性，但不触发 `vendor.enabled = false`。或者接受此行为——模型级冷却已取代 Vendor 级权重作为路由决策依据。

---

## 五、验证状态

- `npm test`：✅ 28 文件 249 测试全绿
- `npm run typecheck`：✅ 通过
- `npm run build`：✅ 116 kB → `dist/index.js`
