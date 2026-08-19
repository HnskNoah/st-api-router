# ST-Quicker-Api — AI Agent 指南

> 先读本文，再改代码。最后更新：2026-08

## 项目身份

SillyTavern 浏览器扩展，按逻辑模型在多个 Vendor + Key 之间自动路由 API 请求。
TypeScript + ES Modules，Vite 构建，Vitest 测试。

## 硬约束（不可违反）

1. **不能主动测试**：不对 vendor 发连接测试、不调 `/v1/models`、不发最小 chat。所有健康状态**只来自真实业务流量**（`GENERATION_STARTED`/`ENDED`/`STOPPED` + toastr 观察）。
2. **不能引入服务端**：无 PostgreSQL/Redis/独立网关进程。状态全部存在 ST 设置 JSON（`src/settings`、`src/state`）。
3. **不代理请求**：ST 原生发请求，插件只改连接字段（`patchGenerateData` 拦截模式）。不持有 HTTP 服务。
4. **浏览器环境**：依赖 `@sillytavern/*` 宿主 API，无 Node 运行时。
5. **不自动重发**：失败后明确告知用户，不静默重试。
6. **不轮询模型**：只在用户点"拉取模型"按钮时拉取。

## 核心架构笔记

- **当前熔断粒度是 Vendor 级**（`vendor.failStreak` → `vendor.enabled=false`），一个模型挂会误伤同 Vendor 的其他模型。
- **旧 Provider 层已有正确的 `key × model` 级熔断**（`ProviderKey.circuits[model]`），新 Group 层迁移时丢失了。设计稿 `docs/PER_MODEL_HEALTH_DESIGN.md` 写了完整方案但**尚未实现**。
- **路由拦截**：`GENERATION_STARTED` 选路 + 设 `state.active` → `CHAT_COMPLETION_SETTINGS_READY` 时 `patchGenerateData` 改写连接字段。独立流（MClite 等）无 `GENERATION_STARTED`，走 `resolveFallbackRoute` 兜底。

## 开发命令

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run（全部测试）
npm run build       # vite build → dist/index.js
```

## 编码提示

- **纯函数优先**：核心逻辑放 `src/domain/`（纯函数，可测试）；ST 依赖放 `src/routing/`（接线层）。
- **相对路径 import 带 `.js` 后缀**（`import { x } from './y.js'`）；`@sillytavern/*` 用裸名。
- **Schema 迁移**：`SCHEMA_VERSION` 在 `src/constants.ts` 定义，`src/settings/initialize.ts` 做增量迁移。旧数据通过 `normalize*` 函数安全补全。
- **DOM 用 jQuery**（ST 自带），CSS 类名前缀 `quicker-api__`。
- **日志用 `src/debug.ts` 的 `debugLog`**，不要裸 `console.log`。

## 文档索引

| 文档 | 说明 |
|------|------|
| `docs/ROUTING_REDESIGN.md` | 完整架构设计、路由流程、实现状态 |
| `docs/PER_MODEL_HEALTH_DESIGN.md` | **设计稿，未实现**：Key × 模型级被动健康检测 |
| `docs/CALL_CHAIN.md` | MClite 调用链 + 路由触发对比表 |
| `docs/HANDOFF_GATEWAY_DESIGN_REVIEW.md` | 外部方案评审 + P0 执行清单 |

## 两个常见陷阱

1. **不要引入外部文档推荐的 Postgres/Redis/服务端网关**——本项目约束不允许。
2. **不要改 `vendor.enabled` 以外的熔断机制**——除非你实现了 `docs/PER_MODEL_HEALTH_DESIGN.md` 的模型级熔断。当前 `vendor.enabled = false` 是唯一的熔断手段。