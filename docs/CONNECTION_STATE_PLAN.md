# 连接状态暴露给 ST 方案（Connection State Sync Plan）

> 目的：解决 ui-redesign 拦截模式下「ST 界面看不到真实连接」的问题——ST 顶部的连接状态、source 下拉、key 框、模型框仍显示用户手动设置的原值，不反映路由实际用的 Vendor/Key/model。
> 状态：方案设计，待实现。
> 最后更新：2026-08

---

## 1. 问题

ui-redesign 走**纯拦截模式**（`patchGenerateData` 只改 `generate_data` 请求载荷），**不碰** `oai_settings` / `secret_state` / ST DOM。后果：

- ST 顶部连接状态、Chat Completion Source 下拉、Key 框、模型框**仍显示用户手动设置的原值**，与实际路由 Vendor 不一致
- 用户看着 ST 以为连的是 A，实际每次生成路由到 B/C…
- 一些依赖 `oai_settings` 的 UI/插件读到的是旧连接

**直接后果**：ST 界面误导 + 「当前到底连了谁」无感知（控制台仪表盘虽有，但 ST 原生界面没有）。

---

## 2. 现状核实（ui-redesign）

### 2.1 切换 Vendor 不触发 `/v1/models`（已核实）

ui-redesign 的所有网络调用点（grep 全仓）：
- `routing/ui/right-vendor.ts:301` → `fetch('/api/backends/chat-completions/status')`：仅「拉取模型」按钮（用户主动点）
- `secrets/api.ts` → `/api/secrets/{read,write,rotate,find,delete}`：插件自身的 key 管理

**切换 Vendor / 逻辑模型时**：只改 `hooks.state.active` + 下次生成 `patchGenerateData`。生成本身（`sendOpenAIRequest`）只发 `/api/backends/chat-completions/generate`，**不发 `/models`**。所以 ui-redesign 切换 Vendor **不会**触发 `/v1/models`。

### 2.2 `setOnlineStatus('Valid')` 是无害的

- 只设 `online_status` 字符串 + `displayOnlineStatus()`（改顶部显示）+ emit `ONLINE_STATUS_CHANGED`
- `ONLINE_STATUS_CHANGED` 唯一监听者在 tokenizers.js（仅 textgenerationwebui 后端，无害）
- 不触发网络请求

---

## 3. main 的可复用实现（参考蓝本）

`src/routing/apply-provider.ts`（ui-redesign 已存在，目前是**死代码**）：

### `applyConnectionFields(format, endpoint, apiKey, model)` —— 核心

| 步骤 | 内容 | 副作用 |
|---|---|---|
| 写 `oai_settings` | `chat_completion_source` / `custom_url` / `custom_model` / `custom_api_format`（custom）；`reverse_proxy` / `deepseek_model`（deepseek） | 无 |
| 写 `secret_state` | `secret_state[CUSTOM/DEEPSEEK] = apiKey`（明文） | 无 |
| `syncInput`（默认 `input` 事件） | `#custom_api_url_text` / `#custom_model_id` / `#api_key_custom` / `#openai_reverse_proxy` | `input` 不触发连接 |
| `#chat_completion_source` 仅在「源真变了」`change` | `if (!wasCustom) syncInput('#chat_completion_source', 'custom', 'change')` | **唯一可能触发 reconnect 的点** |
| `setOnlineStatus('Valid')` | 状态显示 | 无 |

`applyVendorConnection(vendor, apiKey, model)` 封装了它 + `setOnlineStatus('Valid')`。

### ⚠️ main 的代价（已核实，我们不采用）

main 在 source 变化时 `$('#chat_completion_source').trigger('change')` **会级联触发 `/v1/models`**：
```
source change → reconnectOpenAi → api_button_openai.click → getStatusOpen
→ POST /api/backends/chat-completions/status
→ 后端 GET {endpoint}/models   ← chat-completions.js:1987
```
这违反 AGENTS.md 硬约束 1（不主动测试 vendor / 不调 /v1/models）。**所以不能照搬「trigger source change」。**

---

## 4. 本方案：同步但不主动连接

### 核心原则

**同步 `oai_settings` + `secret_state` + DOM 显示，但绝不 `trigger('change')` source**——`setOnlineStatus('Valid')` 已是绿的，ST 不 gate custom 源发送（`canBypass`），真实请求由拦截层改写。

### 关键区别 vs main

| | main | 本方案 |
|---|---|---|
| 写 `oai_settings` 连接字段 | ✅ | ✅ |
| 写 `secret_state` key | ✅ | ✅ |
| `syncInput`（input 事件） | ✅ | ✅（input 不连） |
| source 变化 `trigger('change')` | ✅ → 触发 `/v1/models` | ❌ **绝不做** |
| `setOnlineStatus('Valid')` | ✅ | ✅ |
| 触发 `/v1/models` | 切换源时 | **永不** |

### 方案 B 的副作用边界（已核实）

1. ST 无 MutationObserver 盯 `oai_settings`/连接 DOM → 我们直接改值不会被覆盖
2. `setOnlineStatus` / secret 写操作不触发连接
3. ST 只有 source `change` 才 `reconnectOpenAi` → 我们不触发
4. custom 源 `canBypass=true`（openai.js:4431），发送不 gate 连接状态
5. 唯一注意：改 source 字段时用 `.val()` 直接设，**不 `.trigger('change')`**

---

## 5. 实现改动点

### 5.1 激活 `apply-provider.ts` 的同步（无改动，直接复用）

`applyConnectionFields` / `applyVendorConnection` 已存在，仅需在 hooks 调用。

### 5.2 hooks.ts —— 路由后同步 ST 连接

在 `runGenerationRouting` 和 `routeFallbackIfNeeded` 中，`patchGenerateData` 之后补：

```ts
// 同步 ST 原生连接字段（写 oai_settings + secret_state + DOM 显示，不触发 source change）
applyVendorConnection(unit.vendor, unit.entry.apiKey, unit.realModel);
```

- **主路由**（`onChatCompletionSettingsReady` 有 active 时）：patch 后 sync
- **兜底路由**（fallback）：patch 后 sync
- **deepseek/custom 都覆盖**（applyConnectionFields 内部分支）

### 5.3 关键：改 apply-provider 的 source 同步（避免 /v1/models）

当前 `applyConnectionFields` 里有 `if (!wasCustom) syncInput('#chat_completion_source', ..., 'change')`。本方案**删除这段 change 触发**，改为：`$('#chat_completion_source').val(source)`（只改显示，不触发）。否则会重蹈 main 的 `/v1/models`。

（保留 `oai_settings.chat_completion_source = ...` 直接赋值——它本身不触发任何事件。）

### 5.4 单元测试

为 `applyConnectionFields` 补测试：断言它写 oai_settings/secret_state/DOM，且**不触发 source change**。需 mock jQuery `$` 与 ST 导入。

---

## 6. 要复用的 UI / 代码

| 项 | 来源 | 状态 |
|---|---|---|
| `apply-provider.ts` 的 `applyConnectionFields` / `applyVendorConnection` / `syncInput` | main（ui-redesign 已存在） | ✅ 待激活（死代码） |
| `secrets/api.ts` 的 `ensureSecretId` / `readAuthoritativeSecretState` | ui-redesign 现有 | ✅ 已用 |
| `setOnlineStatus` | ui-redesign 现有 | ✅ 已用 |
| 逻辑模型编辑 UI（补附加参数入口） | main 旧 `logical-model-editor.ts` 的 YAML textarea | ➕ 待补回控制台 |
| 控制台右栏 tab | ui-redesign 现有（settings/vendor/route/mapping） | ✅ |
| 控件级复用（field / select2 / Popup 封装的抽取） | 方案管理与控制台现有 | ➕ 待抽公共 `controls.ts` |

---

## 7. 后续（本轮不做的）

- **附加参数编辑入口**：补回控制台逻辑模型编辑弹窗（include/exclude body + headers YAML）
- **控件级复用**：抽 `routing/ui/controls.ts`（field/下拉/select2/Popup 封装），方案管理 + 控制台共用
- **手机端**：见 UI_REDESIGN.md §3（底部面板，未实现）

---

## 8. 验证

- 路由到 custom Vendor → ST source 下拉/url/key 框显示对应 Vendor，顶部连接绿
- 路由到 deepseek Vendor → ST 显示 deepseek 源
- 全过程中 DevTools Network 无 `/v1/models` 或悬空 status 请求
- 发送消息正常（ST 不 gate custom 源）
