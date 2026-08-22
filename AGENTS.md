# ST-Quicker-Api — AI Agent 指南

> 先读本文，再改代码。最后更新：2026-08
> 目标：让接手 agent 冷启动——30 秒理解项目做什么、代码在哪、机制是什么、改哪里不乱。

## 项目身份

SillyTavern 浏览器扩展：按**逻辑模型**在多个 **Vendor + Key** 之间自动路由 LLM API 请求。
TypeScript + ES Modules，Vite 构建（`dist/index.js`），Vitest 测试。

## 架构一图

```
用户选的逻辑模型（如 deepseek-v4-flash）
   ↓ 生成时（GENERATION_STARTED）
路由引擎 routeGroupOnce（domain/group-routing.ts）
   ↓ 成功率加权随机选一个承载链 = Group的Key条目 + Vendor + 真实模型
拦截模式 patchGenerateData（routing/patch-generate-data.ts）改写 generate_data
   ↓ ST 原生发请求到该 Vendor（插件不代理）
生成结束 recordModelFailure/Success（domain/model-health.ts，Key×真实模型级熔断）
```

## 核心机制（必懂，否则改不对）

1. **拦截模式**：不改 ST 的 `oai_settings` 持久连接，只改**本次请求的 generate_data**（source/custom_url/secret_id/reverse_proxy/proxy_password/model）。入口 `src/routing/hooks.ts`（GENERATION_STARTED→选路；CHAT_COMPLETION_SETTINGS_READY→patch；GENERATION_ENDED→记账）+ `patch-generate-data.ts`。
2. **连接状态空占位**：启动 `ensureEmptyConnectionPlaceholder()`（lifecycle.ts）把 ST 连接置为 **custom + 空 URL** 并持久化 → 避免「自动连接上次服务器」连到上次 vendor；`setOnlineStatus('Valid')` 双保险。**绝不 `trigger('change')` source**（会触发 ST reconnect → /v1/models，违反硬约束1）。
3. **密钥走 ST secret 槽**：`secrets/api.ts`，key 存 ST 的 `/api/secrets/*`（`ensureSecretId`/`rotateSecretVerified`），路由时拿 secretId 写进 generate_data，ST 后端 `readSecret` 取真实 key。**不主动发 /v1/models**。
4. **健康是 Key×真实模型粒度被动判断**：`model-health.ts`，只从真实请求结果记（fatal/rate_limited 立即进冷却、temp/unknown 累计达阈值后进冷却；统一用 `cooldownSeconds × 1000 × 退避倍数`，倍数 1→2→4→…→32）。**不自动禁用整个 vendor.enabled**（那仅用户手动）。
5. **自动重试链**：`routing/retry-chain.ts`（状态机）+ hooks 接线。失败/空回复 → 排除失败渠道、延时点击再生成；下一次 STARTED 按 self（自己的 regenerate/swipe 到场）/ inherit（自动生成接管，automatic_trigger=true）/ fresh（用户操作，清链）消费。状态机、守卫与不变量见 `docs/RETRY_CHAIN_DESIGN.md`。

## 目录（关键文件）

```
src/
  index.ts           入口 → lifecycle.initQuickerApi
  lifecycle.ts       初始化/启动空占位/teardown
  state.ts           运行时内存状态
  constants.ts       SCHEMA_VERSION / FORMATS / normalizeRoutingSettings
  types.ts           领域类型（Vendor/Group/LogicalModel/路由设置…）
  debug.ts           debugLog（内存缓冲可导出）+ installFetchLogging
  operation-queue.ts 连接操作串行队列
  domain/            纯函数（可测）：
    vendor.ts         Vendor/Group/LogicalModel 规范化 + 归类 + 迁移
    group-routing.ts  路由引擎（候选/加权随机/sticky/RPM/模型级过滤）
    model-health.ts   Key×真实模型级被动熔断
    generation-guard.ts 预设切换/密钥安全阻断
    quick-action.ts   Quick Actions 纯函数
  routing/           接线层（ST 依赖）：
    hooks.ts          生成生命周期路由 + 记账
    patch-generate-data.ts 拦截改写核心
    init.ts           guard + 钩子注册 + 手动路由入口
    apply-provider.ts vendor 连接同步（含 applyVendorConnection，当前死代码可复用）
    manual-route.ts   手动路由锁定
    fallback.ts       兜底路由（独立流插件）
    failure-observer.ts 失败探针（分类）
    retry-chain.ts    自动重试链状态机（见 docs/RETRY_CHAIN_DESIGN.md）
    ui/               控制台 UI（见下）
  quick-actions/      ⚡ 快捷方案（菜单入口/管理/执行器）
  secrets/            密钥 API（api.ts）+ 纯 helper（clear.ts）+ 访问（access.ts）
  settings/           状态访问（access.ts）+ 初始化规范化（initialize.ts）
  utils/              文本/模型列表/url/headers/id/format
```

## UI 结构（控制台 = 桌面三栏 + 手机底部面板）

```
routing/ui/
  console-panel.ts         桌面编排器（isMobile 时路由到 mobile）csl-*
  console-panel-mobile.ts  手机底部 Sheet qam-*
  dashboard.ts             左栏/手机：逻辑模型仪表盘（当前置顶 + ⚙附加参数）
  route-detail.ts          中栏/手机：路由详情（可用路由+冷却+失败记录）
  right-vendor.ts          Vendor 管理（列表/Key增删/健康pill/拉模型）
  right-route.ts           路由功能（参数/分组/逻辑模型/数据/危险）
  right-mapping.ts         映射规则/忽略
  logical-params-editor.ts 逻辑模型附加参数弹窗（左栏/右栏共用）
  controls.ts              共用控件 showEditorDialog
  console-helpers.ts       共用辅助（activeGroup/saveSettingsNow/cslField…）
UI 入口：发送栏 ⚡ → Quick Actions 菜单 → 「路由控制台」→ openConsolePanel()
```

## 开发命令

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run（全部测试）
npm run build       # vite build → dist/index.js
```

## 硬约束（不可违反）

1. **不能主动测试**：不对 vendor 发连接测试、不调 `/v1/models`、不发最小 chat。健康只来自真实业务流量。
2. **不能引入服务端**：无 PostgreSQL/Redis/独立网关。状态全在 ST 设置 JSON。
3. **不代理请求**：ST 原生发请求，插件只改连接字段（拦截模式）。**不 `trigger('change')` source**。
4. **浏览器环境**：依赖 `@sillytavern/*` 宿主 API。
5. **默认不重发，自动重试需显式开启**：`autoRetryCount`（路由设置「自动重试次数」，默认 0=关闭）开启后，失败/空回复会自动排除当前渠道、换路由重生成，达上限停止并明确告知；关闭时失败明确告知，不静默重试。
6. **不轮询模型**：只在用户点「拉取模型」时拉。
7. **禁止巨石函数**：单文件 ≤500 行，UI 按职责拆（容器/各栏/弹窗）。

## 编码习惯

- 纯函数放 `domain/`，ST 依赖放 `routing/`。
- 相对 import 带 `.js` 后缀；`@sillytavern/*` 裸名。
- DOM 用 jQuery；CSS 前缀 `csl-`（控制台）/ `qam-`（手机）/ `quicker-api__`（通用）。
- 日志用 `debug.ts` 的 `debugLog`。
- Schema 纯规范化（无数据迁移，`delete` 丢弃旧字段）。

## 陷阱

1. 勿引入外部文档推荐的 Postgres/Redis/网关。
2. 勿用 `vendor.enabled=false` 做自动熔断（那是用户手动操作）。
3. 勿在路由时 `trigger('change')` source——触发 reconnect/ /v1/models。
