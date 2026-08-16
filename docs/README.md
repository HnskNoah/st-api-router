# ST Api Router

SillyTavern 扩展：按逻辑模型在各 Vendor + Key 之间自动路由 API 请求。

## 安装

1. 在 SillyTavern 的 `public/scripts/extensions`（或第三方扩展目录）中放置本扩展目录
2. 插件入口为 `dist/index.js`（`manifest.json` 的 `js` 字段 = `dist/index.js`）
3. 在 SillyTavern 扩展面板启用本扩展

## 概念

- **Vendor（模型商）**：接入的 API 服务商，持有自己的 Endpoint、限流（RPM）、上下文/输入/输出 token 上限。
- **Key（密钥）**：具体可用的 API Key，挂在某个 Vendor 下；Key 级保存拉取到的模型列表与映射。一个 Vendor 可有多个 Key，不同 Key 可能拿到不同模型。
- **Logical Model（逻辑模型）**：你定义的模型抽象名（如 `deepseek-v4-flash`、`Gemini 系`）。真实模型按核心名归并到逻辑模型。
- **Group（分组）**：使用环境，持有当前逻辑模型与一组 Vendor + Key 条目；路由按分组选择。

## 功能

- **生成前自动路由**：启用路由后，生成前按当前分组的逻辑模型，从可用 Vendor + Key 中随机选一个改写 SillyTavern 连接（带 RPM 限流、失败自动禁用 Vendor）。
- **模型管理**：按 Vendor/Key 拉取模型，构建逻辑模型与真实模型映射；已归类 / 未归类真实模型折叠展示，可搜索。
- **批量创建与归并**：从已拉取模型批量创建逻辑模型并自动映射（核心名匹配、统一小写）；可一键把某个逻辑模型合并到另一个。
- **便捷按钮**：在发送栏 / Quick Reply 添加一个入口，展开后一键切换 preset + 逻辑模型。
- **导入导出**：导出 / 导入完整路由配置 JSON（含 Key，注意保管）。

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
