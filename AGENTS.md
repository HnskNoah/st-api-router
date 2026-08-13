# AGENTS.md

## 工作区文件操作约定

- 读写工作区文件优先使用 **MCP 工具**（`code-tools-mcp_*`、`filesystem_*`），效率更高。
- 只在确有需要时（如目录删除、移动、批量重命名）才用 pwsh，pwsh 命令可以加 `rtk` 前缀。
- 读文件用 `read` / `code-tools-mcp_read_file` / `filesystem_read_text_file`，不要用 `Get-Content`。

## 项目状态

ST-Quicker-Api 已从 `main` 的 `index.js`（2593 行巨石）重构为纯 TS7 模块化项目（分支 `refactor/ts-modular`）。
计划见 `docs/REFACTOR_PLAN.md`；旧 `index.js` 已删除，源码在 `src/`。

- 工具链：TypeScript 7.0.2 / Vite 6 / Vitest 4.1.10
- 宿主导入用 `@sillytavern/*` 别名，vite `stResolver` 插件外置为绝对路径
- 产物：`dist/index.js`（ES），manifest `"js": "dist/index.js"`
- 验收：`npm run typecheck` / `npm run test` / `npm run build` 全绿
