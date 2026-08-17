# MClite 发送消息到接收 AI 回复的完整调用链

> 与本插件路由触发对比。最后更新：2026-08。

## 环境架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  SillyTavern 宿主页面                                                │
│  加载了:                                                             │
│  ├─ JS-Slash-Runner 插件 (TavernHelper)                             │
│  │  ├─ 注册 `window.TavernHelper` (含 generate 等)                   │
│  │  ├─ 注册 `window.SillyTavern.getContext()`                        │
│  │  └─ 创建 iframe 并注入代码（predefine.js）                         │
│  │                                                                  │
│  ├─ MagVarUpdate 插件 (MVU 变量框架)                                  │
│  │  ├─ 注册 `window.Mvu` (getMvuData/replaceMvuData 等)              │
│  │  ├─ 监听 CHAT_COMPLETION_SETTINGS_READY → 改采样参数/工具调用      │
│  │  └─ 监听 AI 回复，解析 `_.set()` 命令更新变量                       │
│  │                                                                  │
│  └─ ST-Quicker-Api (本插件)                                         │
│     ├─ 监听 GENERATION_STARTED → 路由选路 + 设 active + token 钳制   │
│     └─ 监听 CHAT_COMPLETION_SETTINGS_READY → patch generateData     │
│        ├─ 有 active → patchGenerateData(拦截模式)                    │
│        └─ 无 active → resolveFallbackRoute(兜底路由)                 │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  iframe (MClite 卡片)                                          │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐         │  │
│  │  │ BottomBar   │→│ GameLayout   │→│ useAIInteraction │        │  │
│  │  │ (发送按钮)   │ │ (桥接)       │ │ (核心逻辑)      │         │  │
│  │  └─────────────┘ └──────────────┘ └───────┬──────┘         │  │
│  │                                            │                  │  │
│  │  predefine.js 注入的全局变量:               │                  │  │
│  │  ─ window.generate  → TavernHelper.generate│                  │  │
│  │  ─ window.TavernHelper → parent.TavernHelper│                 │  │
│  │  ─ window.SillyTavern → parent.SillyTavern  │                 │  │
│  │  ─ window.Mvu → parent.Mvu (getter)        │                  │  │
│  │  ─ window.eventOn/eventOff → parent 事件系统│                 │  │
│  │  ─ window.toastr → parent.toastr            │                  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## 第一阶段：用户点击发送 → 发起 AI 请求

```
Step 1  BottomBar.vue
────────────────────
  <button @click="handleSend">
    └─ handleSend()
       ├─ if (!canSend.value) return
       ├─ addToHistory(message)
       ├─ emit('send', message)
       ├─ inputText.value = ''
       └─ nextTick(() => resetHeight())
```

```
Step 2  GameLayout.vue
──────────────────────
  <BottomBar @send="handleSend" />
    └─ handleSend(message: string)
       └─ sendMessageToAI(message)
```

```
Step 3  useAIInteraction.ts — sendMessageToAI()
────────────────────────────────────────────────
  sendMessageToAI(userInput: string)
    ├─ isProcessing.value = true
    ├─ error.value = null
    ├─ buildPromptWithVariables(userInput.trim())
    │  ├─ 从 window.Mvu.getMvuData({ type: 'message', message_id: 'latest' })
    │  │  获取完整变量表 (stat_data)；回退：mvuStore 缓存
    │  └─ 构建 prompt 字符串:
    │      <status_current_variables>
    │      { 完整 stat_data JSON }
    │      </status_current_variables>
    │      <last_ai_response>
    │      { 上一次 AI 回复全文 }
    │      </last_ai_response>
    │      { 用户输入内容 }
    │
    ├─ shouldStream = appStore.streamingEnabled
    │
    └─ await (window as any).generate({
         user_input: promptWithVariables,
         should_stream: shouldStream,
       })
       └─ 注意：window.generate 是 JS-Slash-Runner 注册的 TavernHelper.generate
```

**路由触发点：** `window.generate()` 会在 JS-Slash-Runner 内部 emit `CHAT_COMPLETION_SETTINGS_READY`，但**不 emit `GENERATION_STARTED`**。

## 第二阶段：JS-Slash-Runner 生成处理

```
Step 4  TavernHelper.generate(config)
──────────────────────────────────────
  (src/function/index.ts: TavernHelper 对象)
  (src/function/generate/index.ts: export async function generate)

  generate(config: GenerateConfig)
    ├─ config = { user_input, should_stream, ... }
    ├─ fromGenerateConfig(config) → detail.GenerateParams
    │  ├─ generation_id: uuidv4()
    │  ├─ user_input: config.user_input
    │  ├─ use_preset: true
    │  ├─ stream: config.should_stream
    │  ├─ bindToStopButton: true
    │  └─ ...
    └─ iframeGenerate(params)
```

```
Step 5  iframeGenerate(params)
──────────────────────────────
  (src/function/generate/index.ts: 第 276 行)

  iframeGenerate(params)
    ├─ 1. 注册 abortController，绑定到 ST 停止按钮
    │
    ├─ 2. processUserInputWithImages(user_input, use_preset, image)
    │    → 处理用户输入（正则替换、宏替换、图片数组处理）
    │
    ├─ 3. eventSource.emit(GENERATION_AFTER_COMMANDS, ...)
    │
    ├─ 4. prepareAndOverrideData(baseData, processedUserInput)
    │    → 准备并过滤基础数据
    │    → 包括：角色卡、世界书、聊天历史、注入提示词等
    │    → max_chat_history 控制 prompt 包含多少历史楼层
    │
    ├─ 5. 分流:
    │   ├─ use_preset=true → handlePresetPath()
    │   │  → 读取预设配置（temperature, top_p, 等）
    │   │  → 构建 ordered_prompts
    │   │  → 处理 inject prompts
    │   │
    │   └─ use_preset=false → handleCustomPath()
    │
    ├─ 6. eventSource.emit(GENERATE_AFTER_DATA, generate_data)
    │
    └─ 7. generateResponse(generate_data, stream, generationId, ...)
```

```
Step 6  generateResponse(generate_data, stream, generationId, ...)
──────────────────────────────────────────────────────────────────
  (src/function/generate/responseGenerator.ts)

  generateResponse(generate_data, stream, generationId, ...)
    ├─ 创建 StreamingProcessor 实例
    │
    ├─ 调用 sendOpenAIRequest()  (来自 @sillytavern/scripts/openai)
    │  → 向配置的 AI 后端 API 发送请求
    │  → 支持 OpenAI / Claude / 自定义 API 等
    │
    ├─ 流式模式:
    │  ├─ getStreamingReply() / getEventSourceStream()
    │  ├─ 逐 token 接收 AI 回复
    │  ├─ 累积到 StreamingProcessor.result
    │  └─ 每次收到 token 时，触发 eventSource.emit(GENERATION_TOKEN)
    │
    └─ 非流式模式:
       ├─ 等待完整回复
       └─ 直接返回完整文本
```

## 第三阶段：ST-Quicker-Api 路由介入

MClite 的 `window.generate()` 经由 JS-Slash-Runner 内部流程，在 `generateResponse()` 之前会 emit `CHAT_COMPLETION_SETTINGS_READY`。路由拦截在此发生：

```
JS-Slash-Runner 内部 (prepareAndOverrideData 之后)
    │
    ├─ eventSource.emit(CHAT_COMPLETION_SETTINGS_READY, generateData)
    │
    ▼
├─────────────────────────────────────────────────────────────┤
│  ST-Quicker-Api  onChatCompletionSettingsReady(generateData) │
│                                                              │
│  ├─ guard 哨兵检查 (isGenerationBlockedByGuard)               │
│  │  ├─ source=custom, 有 active → pass (正常生成)            │
│  │  └─ source=openai (已被 patch) → skip (预期行为)           │
│  │                                                           │
│  ├─ active ≠ null → patchGenerateData(generateData)          │
│  │  → 拦截模式：source='openai', reverse_proxy=X,             │
│  │    proxy_password=Y, model=Z                              │
│  │                                                           │
│  └─ active = null → resolveFallbackRoute(generateData)       │
│     → 兜底路由：按当前 Group 逻辑模型选路接管                  │
│     → 不弹 token 弹窗、不设 state.active（独立流不配对）       │
│                                                              │
│  MagVarUpdate 也监听同一事件 (同时触发):                       │
│  ├─ applyExtraModelRequestOverrides(generateData)             │
│  │  → 仅在额外模型解析期间改 temperature/max_tokens 等         │
│  │  → 正常生成时无操作                                        │
│  ├─ overrideToolRequest(generateData)                         │
│  │  → 仅在额外模型解析且工具调用模式时设 tools/tool_choice      │
│  │  → 正常生成时无操作                                        │
│  └─ filterPrompts(generateData)                               │
│     → 过滤 prompt 内容（仅影响 ordered_prompts 等文本字段）     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
    │
    ▼  (generateData 已被 patch，继续流回 JS-Slash-Runner)
    │
    JS-Slash-Runner  generateResponse(generateData, ...)
    → sendOpenAIRequest()  // 发到被路由后的端点
```

## 第四阶段：响应返回 + 事件通知

```
Step 7  JS-Slash-Runner — 生成完成 → 事件通知 iframe
────────────────────────────────────────────────────────────────
  (src/function/generate/responseGenerator.ts)
  (src/function/event.ts — 事件系统)

  生成结束后:
    ├─ eventSource.emit(event_types.GENERATION_ENDED, text, generationId)
    │  → 触发 ST 自身的事件
    │  → ST-Quicker-Api onGenerationEnded 记录 success/failure
    │
    └─ _eventEmit('STREAM_TOKEN_RECEIVED_FULLY', text, generationId)
       → 通过 iframe_events 系统通知 iframe
       → predefine.js 中 _eventOn 映射
       → iframe 端 eventOn(iframe_events.STREAM_TOKEN_RECEIVED_FULLY, handler)
```

## 第五阶段：MClite 处理 AI 回复

```
Step 8  useAIInteraction.ts — 事件监听器
────────────────────────────────────────────────────────────────
  setupAIListeners()
    ├─ eventOn(iframe_events.STREAM_TOKEN_RECEIVED_FULLY, streamingHandler)
    └─ eventOn(iframe_events.GENERATION_ENDED, streamEndHandler)

  streamEndHandler = (text: string, id: string) => handleGenerationEnd(text, id)
    └─ processAIResponseDirectly(finalText, generationId)
```

```
Step 9  useAIInteraction.ts — processAIResponseDirectly(finalText)
───────────────────────────────────────────────────────────────────
  processAIResponseDirectly(finalText, generationId)
    ├─ 1. validateResponseFormat(finalText)
    │    → 检查 AI 回复是否包含必需标签（<gametxt> 等）
    │
    ├─ 2. extractGameText(finalText)
    │    → 提取 <gametxt> 标签内容 → 设置 currentContent.value
    │    → 用于 MainContent 面板显示
    │
    ├─ 3. parseAndUpdateVariables(finalText)
    │    → 提取 <UpdateVariable> 标签内容
    │    → 解析 _.set() / _.assign() / _.add() / _.remove() 命令
    │    → 调用 mvuStore.executeCommand() 逐个执行
    │       └─ mvuService.setVariable(path, value)
    │          ├─ 尝试 Mvu.setMvuVariable(mvuData, path, value)
    │          └─ 失败则手动创建路径 → Mvu.replaceMvuData()
    │
    ├─ 4. 处理 <UpdateVariable> 中的命令:
    │    ├─ 由 MagVarUpdate 的 updateVariables() 自动处理
    │    ├─ 触发 MVU 事件:
    │    │  ├─ VARIABLE_UPDATE_STARTED
    │    │  ├─ COMMAND_PARSED
    │    │  ├─ SINGLE_VARIABLE_UPDATED
    │    │  └─ VARIABLE_UPDATE_ENDED
    │    └─ mvuStore 监听这些事件，同步更新 Vue 响应式状态
    │       → 各面板 (人事/文档/表单) 自动刷新
    │
    ├─ 5. lastAIResponse.value = finalText  // 保存用于下次上下文注入
    │
    └─ 6. performAutoSave()  // 自动存档
```

## 路由触发对比

不同插件/功能的 LLM 请求触发 ST-Quicker-Api 路由的情况：

| 来源 | 调用方式 | 触发 GENERATION_STARTED | 触发 CHAT_COMPLETION_SETTINGS_READY | 路由路径 | 备注 |
|------|---------|------------------------|-------------------------------------|---------|------|
| **MClite 正常生成** | `window.generate()` → TavernHelper `generate()` | **否** | **是** | 兜底路由 (`resolveFallbackRoute`) | 最长路径，见上文完整调用链 |
| **ST 原生发送 (主界面)** | ST 原生 `generate()` | **是** | **是** | 正常路由 (`runGenerationRouting`) | 设 `state.active`，`patchGenerateData` |
| **JS-Slash-Runner 其他脚本** | `generate()` 或 `generateRaw()` | 取决于调用方式 | 取决于调用方式 | 正常/兜底 取决于 | `generateRaw` 不触发任何事件 |
| **MagVarUpdate 额外模型解析** | `generate()` (使用当前预设) | **是** | **是** | 正常路由 | 设 `state.active`，但这是后台任务，routing 可能不是预期行为 |
| **MagVarUpdate 额外模型解析** | `generateRaw()` (其他预设/默认) | **否** | **否** | 不触发 | 直连 TavernHelper API |
| **ST-BaiBai-Book 摘要** | `fetch('/api/backends/chat-completions/generate')` | **否** | **否** | 不触发 | 直连 ST 后端 API |
| **ST-BaiBai-Book 向量/重写** | 直接 `fetch()` 到向量端点 | **否** | **否** | 不触发 | 完全独立连接 |
| **shujuku 剧情推进** | `generateRaw()` / `sendConnectionManagerRequest()` / `fetch()` | **否** | **否** | 不触发 | 直连 TavernHelper/后端 API |

### 关键路径图

```
                              ┌──────────────────────────────┐
                              │  ST 原生 generate()           │
                              │  (主界面/MagVarUpdate 使用当前预设) │
                              │              │               │
                              │  GENERATION_STARTED emit      │
                              │              │               │
                              │  onGenerationStarted          │
                              │  → 路由选路 → 设 active       │
                              │  → token 钳制弹窗(仅超限时)   │
                              │              │               │
                              │  CHAT_COMPLETION_SETTINGS_READY │
                              │              │               │
                              │  onChatCompletionSettingsReady │
                              │  → 有 active → patchGenerateData│
                              └──────────────┬───────────────┘
                                             │
                        ┌────────────────────┴────────────────────┐
                        │                                         │
  ┌─────────────────────┴──────┐            ┌─────────────────────┴──────┐
  │  TavernHelper generate()   │            │  generateRaw() / fetch()   │
  │  (MClite/JS-Slash-Runner)  │            │  (BaiBai-Book/shujuku)     │
  │             │              │            │              │             │
  │  CHAT_COMPLETION_          │            │  不触发任何事件             │
  │  SETTINGS_READY emit       │            │              │             │
  │             │              │            │  直接发到目标端点           │
  │  onChatCompletionSettingsReady│          │              │             │
  │  → 无 active               │            └──────────────┴─────────────┘
  │  → resolveFallbackRoute    │
  │  → patchGenerateData       │
  └────────────────────────────┘
```

## 变量注入格式（MClite → AI 的 prompt 结构）

MClite 每轮发送给 AI 的 `user_input` 格式：

```
<status_current_variables>
{
  "MC": {
    "系统": { ... },
    "玩家": { ... },
    "花名册": { ... },
    "文档": { ... },
    "申请记录": { ... }
  }
}
</status_current_variables>

<last_ai_response>
{ 上一次 AI 回复的完整原始文本，包含所有标签 }
</last_ai_response>

{ 用户输入的文本 }
```

## 关键文件索引

### MClite

| 文件 | 作用 |
|------|------|
| `MC房子组件/game/BottomBar.vue` | 发送按钮 UI，`handleSend()` → `emit('send')` |
| `MC房子组件/game/GameLayout.vue` | 桥接，`<BottomBar @send="handleSend">` → `sendMessageToAI()` |
| `MC房子组件/composables/useAIInteraction.ts` | 核心：`sendMessageToAI()`、`buildPromptWithVariables()`、`processAIResponseDirectly()` |
| `MC房子组件/stores/mvuStore.ts` | MVU 封装：`getVariable()`、`setVariable()`、变量事件监听 |

### JS-Slash-Runner

| 文件 | 作用 |
|------|------|
| `src/function/index.ts` | `TavernHelper` 对象定义，包含 `generate` 等 |
| `src/function/generate/index.ts` | `generate()` → `iframeGenerate()` 完整生成流程 |
| `src/function/generate/responseGenerator.ts` | `generateResponse()` → `sendOpenAIRequest()` 实际 API 调用 |
| `src/iframe/predefine.js` | iframe 全局变量注入（`window.generate`、`eventOn`、`Mvu` 等） |
| `src/function/event.ts` | 事件系统，`iframe_events` 常量定义 |

### MagVarUpdate

| 文件 | 作用 |
|------|------|
| `src/function/global/index.ts` | `Mvu` 对象定义（`getMvuData`、`replaceMvuData` 等） |
| `src/function/update_variables.ts` | `_.set()`/`_.assign()` 命令解析和执行 |
| `src/store.ts` | MVU 变量存储（Pinia store） |
| `src/function/initvar/` | 新聊天变量初始化 |
| `src/function/request/extra_model_request_override.ts` | `applyExtraModelRequestOverrides` — 改采样参数 |

### ST-Quicker-Api

| 文件 | 作用 |
|------|------|
| `src/routing/hooks.ts` | `onGenerationStarted` / `onChatCompletionSettingsReady` / `onGenerationEnded` |
| `src/routing/patch-generate-data.ts` | `patchGenerateData()` — 拦截模式核心纯函数 |
| `src/routing/fallback.ts` | `resolveFallbackRoute()` — 兜底路由决策纯函数 |
| `src/domain/group-routing.ts` | `routeGroupOnce()` — 路由选路引擎 |
| `src/routing/failure-observer.ts` | 失败观察：检测 toastr.error 判定失败 |