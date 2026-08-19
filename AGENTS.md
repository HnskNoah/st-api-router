# ST-Quicker-Api — AI Agent 指南

> 先读本文，再改代码。最后更新：2026-08

## 项目身份

SillyTavern 浏览器扩展，按逻辑模型在多个 Vendor + Key 之间自动路由 API 请求。
TypeScript + ES Modules，Vite 构建，Vitest 测试。

## 硬约束（不可违反）

1. **不能主动测试**：不对 vendor 发连接测试、不调 `/v1/models`、不发最小 chat。所有健康状态只来自真实业务流量。
2. **不能引入服务端**：无 PostgreSQL/Redis/独立网关进程。状态全部存在 ST 设置 JSON。
3. **不代理请求**：ST 原生发请求，插件只改连接字段（`patchGenerateData` 拦截模式）。
4. **浏览器环境**：依赖 `@sillytavern/*` 宿主 API，无 Node 运行时。
5. **不自动重发**：失败后明确告知用户，不静默重试。
6. **不轮询模型**：只在用户点"拉取模型"按钮时拉取。
7. **禁止巨石函数**：单个文件不超过 500 行，超过必须拆为独立模块。UI 模块按职责各司其职（容器/左栏/中栏/右栏/弹窗），不允许多个无关渲染逻辑混在同一文件中。

## 开发命令

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run（全部测试）
npm run build       # vite build → dist/index.js
```

## 编码提示

- **纯函数优先**：核心逻辑放 `src/domain/`（纯函数，可测试）；ST 依赖放 `src/routing/`（接线层）。
- **相对路径 import 带 `.js` 后缀**（`import { x } from './y.js'`）；`@sillytavern/*` 用裸名。
- **Schema 规范化**：`SCHEMA_VERSION` 在 `src/constants.ts` 定义，`src/settings/initialize.ts` 只做纯规范化（`normalizeVendors`/`normalizeGroups`/`normalizeLogicalModels`），并用 `delete` 丢弃旧版遗留字段（无数据迁移）。
- **DOM 用 jQuery**（ST 自带），CSS 类名前缀 `quicker-api__`；新路由控制台使用 `csl-` 前缀（`csl-overlay`/`csl-panel`/`csl-left`/`csl-center`/`csl-right`）。
- **日志用 `src/debug.ts` 的 `debugLog`**，不要裸 `console.log`。

## 两个常见陷阱

1. **不要引入外部文档推荐的 Postgres/Redis/服务端网关**——本项目约束不允许。
2. **不要改 `vendor.enabled` 作为熔断手段**——自动熔断已在 `model-health.ts` 中按 Key × realModel 粒度实现（`circuitsByModel`）。`vendor.enabled = false` 只用于用户手动操作，自动熔断不再触它。