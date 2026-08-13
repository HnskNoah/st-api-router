# st-api-router 设计（LLM Provider 聚合 + 均衡负载）

## 定位

**只做发送链路的扳道工**：每次生成前，把「本次请求发往哪个供应商」写进 ST 原生
`oai_settings`（chat_completion_source=custom、custom_url、custom_model、密钥），
请求/流式/UI/历史全部由 ST 原生处理。

不接触连接层、不做代理、不包请求。密钥明文存于 provider 配置，选路时写入
`secret_state[SECRET_KEYS.CUSTOM]` 与密钥输入框（不做 secrets API 验证/回滚）。

### 必然推论

- 失败感知间接：靠 `GENERATION_ENDED / GENERATION_STOPPED` 事件判定，看不到 HTTP 细节。
- RPM 为「选择时计数」（滑动窗口语义一致）。

## 核心概念

### Provider（供应商，openai-compatible）

```js
provider = {
    id, name, endpoint,           // custom_url
    apiKey,                       // 明文存储，选路时写入 secret_state
    includeBody, excludeBody, includeHeaders,
    fetchedModels: string[],      // 从 /models 拉取：只记录，不重写任何配置
    enabled: true,
    rpm: 60,                      // 每分钟上限；0 = 不限
    weight: 1,                    // 加权轮询权重
    updatedAt,
    // ── 运行时（不持久化）──
    window: [],                   // rpm 滑动窗口时间戳
    circuitUntil: 0,              // 熔断截止
    failStreak: 0,                // 连续失败
    lastError: '',
}
```

### 模型路由条目

```js
modelRoute = {
    model: 'gpt-4o',
    providers: [],                // 显式承载；空 = 从 fetchedModels 自动推断
    strategy: 'round-robin',      // round-robin | weighted
}
```

### 聚合模型清单

各 provider `fetchedModels` 并集去重，纯内存计算。只记录，不改 ST 模型下拉。

## 路由引擎（modules/routing.js，纯函数）

选择流程：候选过滤（enabled / 未熔断 / rpm 余量 / 承载该模型）→ 轮询或加权 →
sticky 会话（同对话固定供应商）。全部不可用 → toast 汇总原因。

- 限流：选择时 `window.push(now)`，窗口内计数 ≥ rpm → 该供应商全部模型排除（自动恢复）。
- 熔断：连续失败 3 次 → 冷却 60s。
- 故障转移（不重发）：失败只计数/熔断；下一轮生成 round-robin 自然轮到下一个供应商。

## 连接层（modules/apply-provider.js）

选路后写回 ST：

```js
oai_settings.chat_completion_source = chat_completion_sources.CUSTOM;
oai_settings.custom_url = provider.endpoint;
oai_settings.custom_model = model;
oai_settings.custom_include_body/exclude_body/headers = provider.include*/exclude*/headers;
secret_state[SECRET_KEYS.CUSTOM] = provider.apiKey;
$('#custom_api_url_text').val(...).trigger('input');   // 同步 UI
$('#custom_model_id').val(...).trigger('input');
$('#api_key_custom').val(provider.apiKey);
```

快照/回滚（选路失败恢复原连接字段）保留轻量版。

## 事件钩子与失败检测（modules/routing-hooks.js + failure-observer.js）

- `GENERATION_STARTED`：选 provider → 写回 ST → sticky 记录 → 开启失败观察窗口
- 失败观察（`toastr.error` 只读拦截）：窗口内任何错误提示视为本次生成失败
  （覆盖 HTTP/网络/流中断错误；用户停止是静默的，由 STOPPED 守卫排除）
- `GENERATION_ENDED`：延迟 50ms 判定（等 STOPPED 先到），按观察结果记录成功/失败
- `GENERATION_STOPPED`：用户停止 → 关闭窗口丢弃结果
- 不重发：失败只计数/熔断，下一轮生成自然轮换

## 数据迁移

- 旧 ST-Quicker-Api `profiles[]` → providers：保留 id（兼容 selectedProfileId/presetBindings/快捷方案引用），
  model+availableModels 记入 fetchedModels；format/secretId/needsSecret 弃用。
- `SCHEMA_VERSION` 递增；旧 profiles 保留一个版本只读兼容。

## 模块划分

```
index.js                       # 主入口 + 快捷方案主线（接线）
modules/provider-store.js      # Provider 形状 + 迁移 + CRUD
modules/model-catalog.js       # 聚合模型清单（纯计算）
modules/routing.js             # 路由引擎（纯函数状态机）
modules/apply-provider.js      # 写回 ST 原生连接字段（轻量快照/回滚）
modules/routing-hooks.js       # 事件钩子
modules/routing-ui.js          # Provider 管理 + 聚合模型选择 UI
modules/preset-cards-compat.js # preset-cards 联动（已存在）
```

## 里程碑

- **M1**：模块骨架 + profiles→providers 迁移 + 访问器接线
- **M2**：聚合清单 + 路由引擎（轮询/权重、RPM、熔断状态机）
- **M3**：UI（Provider 管理 + 聚合模型选择）
- **M4**：apply-provider + 事件钩子（故障转移）
- **M5**：触发面接线（快捷方案 + 全局模型选择）

## 默认值（可改）

sticky 开 / 自动重试关 / 熔断 3 次 60s / rpm 默认 60 / 只支持 openai-compatible（custom source）
