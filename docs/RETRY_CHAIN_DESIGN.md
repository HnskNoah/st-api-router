# 自动重试链与生成生命周期状态机

> 本文是路由钩子（`src/routing/hooks.ts`）与重试链（`src/routing/retry-chain.ts`）的目标行为规格与不变量记录。
> 实现与本文冲突时，以本文为准修代码，或改本文并说明原因。
> 最后更新：2026-08

---

## 0. 事件流（ST 宿主 → 插件）

```
用户发送 / regenerate / swipe
  └─ ST Generate()
       ├─ emit GENERATION_STARTED(type, options, dryRun)      ← script.js:4240
       │    └─ 插件 onGenerationStarted
       │         ├─ quiet/continue/impersonate → 直接跳过（不选路）
       │         ├─ 消费重试链（见 §2.4）
       │         ├─ 清残留 active（I2：上一轮可能丢了 ENDED）
       │         ├─ 选路 → state.active = {unit, logicalModelId, groupId, generationType}
       │         │    custom Key secretId 无法定位 → 本次跳过路由（I5）
       │         └─ failureObserver.begin()
       ├─ deactivateSendButtons()                              ← body.dataset.generating='true'
       ├─ 组装 generate_data
       │    └─ emit CHAT_COMPLETION_SETTINGS_READY             ← openai.js:3052
       │         └─ makeLast 依次执行：
       │              1. guardGenerationWhenBlocked（预设切换/密钥安全阻断 → 改写 source 为哨兵）
       │              2. hooks.onChatCompletionSettingsReady
       │                   ├─ guard 命中 → 丢弃 active + 结算观察器（I4），return
       │                   ├─ active 存在：
       │                   │    ├─ quiet/continue/impersonate → 跳过不 patch（I3）
       │                   │    └─ patchGenerateData（source/url/key/model）
       │                   └─ active 为空 → 兜底路由（quiet/continue/impersonate 跳过；
       │                        swipe 由主路径接管，不进兜底）
       ├─ 发请求 → 成功 / 抛错
       └─ unblockGeneration → activateSendButtons → hideStopButton
            └─ emit GENERATION_ENDED                            ← script.js:3477（唯一发射点，
                                                                     按钮不可见时空操作 → 可能丢失）
  用户点停止 → stopGeneration() → abort + hideStopButton(ENDED) + emit GENERATION_STOPPED
```

**关键事实**：ENDED 可能丢失（斜杠打断 / kobold/horde 流错误 / ping-server 抛错都在 STARTED 之后、
按钮显示之前退出）。防御：新 STARTED 到场即清残留 active（I2）；观察器由 begin/end 配对驱动，
end 只在 active 存在时调用。

---

## 1. 失败记账（onGenerationEnded，50ms 宽限回调）

```
ENDED → 50ms 宽限 → userStopPending? ─ 是 → 忽略（用户停止不算成败）
                    └ 否 → probe = endGeneration()
                         ├─ null（成功）→ recordModelSuccess + recordVendorSuccess + retry.reset()
                         ├─ empty_response → 仅观测（不计失败/冷却）→ 进重试判定
                         └─ 错误 → recordModelFailure（阈值冷却，指数退避 ×2 封顶 ×32）
                                  + vendor.failures++ → 进重试判定
```

guard 阻断的生成本地即知必败：SETTINGS_READY 的 guard 分支直接丢 active 并结算观察器，
ENDED 看到 `!active` 全部跳过——本地阻断绝不污染渠道健康与重试链（I4）。

---

## 2. 重试链状态机

### 2.1 状态

| 状态 | 含义 |
|---|---|
| `idle` | count=0, scheduled=false, 排除集空, 无定时器 |
| `scheduled` | 上一次失败已排定：count=N, scheduled=true, scheduledAt=T, scheduledType∈{regenerate,swipe}, 排除集累积, 定时器已挂 |

`scheduled` 不是稳定态：要么定时器触发点击、要么被下一次 STARTED 消费、要么被守卫复位。

### 2.2 排定：handleFailure（失败或空回复）

门控 `evaluateAutoRetry`（全部满足才可重试）：

| 门控 | 不过时的行为 |
|---|---|
| `autoRetryCount <= 0` | 静默（功能关闭） |
| `retriesUsed >= autoRetryCount` | toast「已达上限」+ 清链 |
| 路由停用 / 扩展禁用 / 预设切换阻断中 | 静默清链（环境变化） |
| 分组不存在/禁用，或当前逻辑模型已切换 | 静默清链（环境变化） |

通过后：排除集 += 失败渠道；count=attempt；scheduled=true；scheduledAt=now；
scheduledType = originType（swipe 失败 → 'swipe'，其余 → 'regenerate'）；
toast「x 秒后自动换路由重试（N/M）」；挂定时器（延迟 = 设置值 + 0~500ms 抖动）。

### 2.3 触发：定时器守卫（按序短路，任一命中即清链取消）

1. 路由停用 或 扩展禁用（I1）
2. `userStopPending`
3. 分组/逻辑模型已切换
4. `document.body.dataset.generating`（ST 正在生成：自动续写/auto-swipe/其他扩展）
5. 重试控件缺失（swipe → `.mes.last_mes .swipe_right`；其余 → `#option_regenerate`）
6. 点击 → ST 以对应 type 发起新一轮生成

### 2.4 消费：classifyRetryChainStart（下一次 GENERATION_STARTED）

| 判定（按序） | 动作 | 说明 |
|---|---|---|
| 未排定 | fresh | 用户新意图，清链 |
| `now - scheduledAt > 认领窗口` | fresh | 过期；窗口 = max(15s, 延迟+抖动+1s 余量)（I10） |
| `type === scheduledType` | **self** | 我们自己的重试到场：保留计数与排除集 |
| `automatic_trigger === true` | **inherit** | 自动生成（群聊自动模式/QR 脚本）就地接管：本次生成即重试，toast 告知，点击定时器作废 |
| 其余 | fresh | 手动操作，清链 |

self/inherit 都不清排除集 → 选路时 `excludeKeys` 生效，不会再次选中已失败渠道。
swipe 失败的重试动作是再次滑动 `.swipe_right`（overswipe→重新生成），不是覆盖式 regenerate（I9）。

### 2.5 循环与终局

重试那次生成照常走 §1：成功 → 清链；再失败且未达上限 → 排定 attempt+1（排除集继续累积）；
达上限 → toast 终止。手动锁定被排除时**保留**（deferred），不被消费（I6）。

---

## 3. 密钥与拉取路径约束

- custom 格式 Key 的路由请求携带 `secret_id`；ST 服务端把 falsy id 解释为「取活动密钥」。
- 因此：custom Key 无法定位 secretId 时，**该次生成跳过路由**走原生连接安全失败（I5）；
  拉取模型同理——写 secret 失败即取消拉取，不带空 id 打 status（UI 层 right-vendor.ts）。
- 拉取会临时切换活动密钥，finally 中恢复原 active（无原 active 则落一个空占位）。

---

## 4. 不变量清单（回归防线）

| # | 不变量 | 来源 |
|---|---|---|
| I1 | teardown/禁用后，挂起的重试定时器不得触发任何点击 | B1 |
| I2 | 新 STARTED 到场时不得存在上一轮残留 active | B5 |
| I3 | quiet/continue/impersonate 永不进入 patch 与兜底路由 | 设计+B6 |
| I4 | guard 阻断的生成不产生失败记账、不排定重试 | B7 |
| I5 | 空 secretId 的 custom 请求不得发出（防活动密钥回退） | B9 |
| I6 | 手动锁定仅被实际使用它的生成消费；被重试排除时保留 | B8 |
| I7 | 仅被分组当前指针引用的逻辑模型不被 prune 回收 | B3 |
| I8 | 错误分类中裸数字状态码必须 `\b` 锚定；reconcile 同步清扫消失模型的健康键 | B2/B4 |
| I9 | swipe 失败的重试动作是再次滑动，不是覆盖式 regenerate | swipe-retry 设计 |
| I10 | 认领窗口 ≥ 延迟+抖动+余量，长延迟配置下自己的重试不会被误判过期 | 窗口击穿修复 |
