# ST Api Router

SillyTavern 扩展：按逻辑模型在各 Vendor + Key 之间自动路由 API 请求。

## 文档索引

| 文档 | 说明 |
|------|------|
| **[ROUTING_REDESIGN.md](docs/ROUTING_REDESIGN.md)** | 架构设计：概念模型、关系图、路由流程、实现状态 |
| **[PER_MODEL_HEALTH_DESIGN.md](docs/PER_MODEL_HEALTH_DESIGN.md)** | 设计稿：Key × 模型级被动健康检测与熔断（**未实现**） |
| **[CALL_CHAIN.md](docs/CALL_CHAIN.md)** | 调用链：MClite 发送消息到 AI 回复的完整流程，含路由触发对比 |
| **[HANDOFF_GATEWAY_DESIGN_REVIEW.md](docs/HANDOFF_GATEWAY_DESIGN_REVIEW.md)** | 外部设计评审：聚合路由网关方案与本项目的对照，含下一步建议 |
| **[agent.md](docs/agent.md)** | **AI agent 项目指南**：硬约束、架构概览、编码规范、设计决策（接手 agent 优先读） |
| **[DEAD_CODE_AND_TESTS.md](docs/DEAD_CODE_AND_TESTS.md)** | 过度设计与无用测试排查记录：死导出清单、已删/保留测试、待处理项 |

## 安装

1. 在 SillyTavern 的 `public/scripts/extensions`（或第三方扩展目录）中放置本扩展目录
2. 插件入口为 `dist/index.js`（`manifest.json` 的 `js` 字段 = `dist/index.js`）
3. 在 SillyTavern 扩展面板启用本扩展

## 概念

- **Vendor（模型商）**：接入的 API 服务商，持有自己的 Endpoint、限流（RPM）、上下文/输入/输出 token 上限。
- **Key（密钥）**：具体可用的 API Key，挂在某个 Vendor 下；Key 级保存拉取到的模型列表与映射。一个 Vendor 可有多个 Key，不同 Key 可能拿到不同模型。
- **Logical Model（逻辑模型）**：你定义的模型抽象名（如 `deepseek-v4-flash`、`Gemini 系`）。真实模型按核心名归并到逻辑模型。
- **Group（分组）**：使用环境，持有当前逻辑模型与一组 Vendor + Key 条目；路由按分组选择。

## 当前功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 生成前自动路由 | ✅ 已实现 | 按 Group 逻辑模型选路，改写 ST 连接 |
| 兜底路由（独立流） | ✅ 已实现 | MClite/JS-Slash-Runner 等独立流自动接管 |
| 手动路由锁定 | ✅ 已实现 | 锁定到下一次生成，之后恢复随机 |
| 手动路由按钮 | ✅ 已实现 | 发送栏旁快捷按钮 |
| Vendor 级 RPM 限流 | ✅ 已实现 | 同一 Vendor 全局限流 |
| Vendor 级失败自动禁用 | ✅ 已实现 | 连续失败达阈值禁用整个 Vendor |
| Key × 模型级熔断 | ⚠️ 设计稿未实现 | `docs/PER_MODEL_HEALTH_DESIGN.md`，待落地 |
| maxContext 钳制 | ✅ 已实现 | 路由时弹窗确认钳制 token 上限 |
| 逻辑模型附加参数 | ✅ 已实现 | 自定义请求头/体（custom source） |
| Vendor / Group 管理面板 | ✅ 已实现 | 拉取模型、映射、编辑、删除 |
| 便捷按钮（Quick Actions） | ✅ 已实现 | 发送栏/QR 按钮栏一键切换预设+模型 |
| 密钥管理 | ✅ 已实现 | 自动写入 secret、一键清除、健康检查 |
| 批量创建逻辑模型 | ✅ 已实现 | 核心名匹配自动映射 |
| 逻辑模型归并 | ✅ 已实现 | 一键合并两个逻辑模型 |
| 导入导出 | ✅ 已实现 | JSON 全量导出（含 Key）、txt 模型列表导出 |
| 预设/Profile 兼容 | ✅ 已实现 | 旧 Profile 折叠保留兼容入口 |

## 开发

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # vite build → dist/index.js
```

## 数据安全

- 导出配置 JSON 包含各 Vendor 的 API Key，妥善保管，勿公开分享。
- 模型列表导出（txt）不含任何密钥。
