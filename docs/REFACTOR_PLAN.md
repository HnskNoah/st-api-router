# ST-Quicker-Api 重构计划（纯 TS7 模块化 + Vite 打包）

## 目标

将 `main` 分支当前的 `index.js`（2593 行巨石文件）忠实移植为模块化 TypeScript 项目：

- 纯 TS7，无 JS 巨石文件，禁止巨石函数
- 功能行为完全不变（Profile 管理 + 便捷方案 + 预设联动 + 模型管理 + 原生导入 + 密钥 fail-closed）
- 能用 Vite 打包，产物 `dist/index.js` 由 SillyTavern 加载
- 纯函数便于测试的部分全部配 vitest 测试

> 注意：`docs/DESIGN.md` 是 `feature/provider-routing` 方向的旧设计稿，与本次忠实移植无关，保留不动。
> 不触碰 `feature/provider-routing`、`feature/preset-cards-compat` 两个分支。

## 范围决策

| 决策点 | 结论 |
|---|---|
| 重构目标 | 忠实移植当前 `index.js`，不引入 Provider 路由新设计 |
| 工作分支 | 新建 `refactor/ts-modular`（从 `main` 拉出） |
| 工具链 | TypeScript ^7.0.2 + Vite ^6 + Vitest ^4.1.10 + @types/jquery/toastr/node |
| 构建方式 | `@sillytavern/*` 别名 + `stResolver` 插件外置宿主模块，ES 产物 → `dist/index.js` |
| manifest | `"js": "dist/index.js"`（css 保持 `style.css`） |

## 模块划分

```
src/
├── index.ts                    # 薄入口，仅组装（≈30 行）
├── types.ts                    # Profile / QuickAction / FormatConfig / Snapshot / 迁移候选
├── constants.ts                # MODULE_NAME / SCHEMA_VERSION / FORMATS / DEFAULT_SETTINGS / SUPPORTED_SOURCES
├── state.ts                    # 运行时可变状态单例（队列、generation、禁用标志等）
├── st.d.ts                     # 宿主模块类型声明（@sillytavern/*）
├── globals.d.ts                # 全局挂载补充声明（presetCards / SillyTavern）
├── utils/                      # ★纯函数（全部配测试）
│   ├── text.ts                 # normalizeText / sanitizeName / escapeHtml
│   ├── id.ts                   # makeId
│   ├── format.ts               # normalizeFormat
│   ├── model-list.ts           # normalizeModelList / modelIdsFromPayload
│   ├── url.ts                  # buildModelsEndpoint
│   └── headers.ts              # parseCustomHeaders
├── domain/                     # ★纯函数（全部配测试）
│   ├── profile.ts              # normalizeProfile / uniqueName / profileMatchesNative / importIdentity / nativeImportFingerprint
│   ├── quick-action.ts         # normalizeQuickAction / normalizeQuickActionPlacement / quickActionDisplayName
│   └── status.ts               # editorHasUnsavedChanges / profileHasCredential（纯判定部分）
├── settings/
│   ├── access.ts               # settings() / profiles() 访问器、blockedSecretKeys/presetBindings 读写
│   └── initialize.ts           # initializeSettings + 旧数据迁移 + 规范化
├── secrets/
│   ├── access.ts               # getSecretEntries / Entry / Active / findMatchingSecret / ensureSecret
│   └── api.ts                  # readAuthoritativeSecretState / writeSecretVerified / rotateSecretVerified / ensureEmptySecret / findSecretBounded
├── fetch.ts                    # fetchWithTimeout / fetchJsonWithTimeout（含 controller 管理）
├── popups.ts                   # callQuickerPopup / cancelOwnedPopups / promptName
├── operation-queue.ts          # enqueueOperation / waitForStableOperationQueue
├── native/
│   ├── snapshot.ts             # snapshotNative / restoreNative
│   ├── fields.ts               # applyNativeFields / syncEditorModelToNative / syncEditorConnectionToNative
│   └── proxy.ts                # getBoundProxyPreset / ensureProxyPresetOption / proxyPresetIsShared / ensureBoundProxyPreset
├── presets/
│   ├── transition.ts           # beginPresetTransition / endPresetTransition
│   ├── save-observer.ts        # installPresetSaveObserver / bindNativePresetSaveCapture / monitorNativeCreatePopup / bindPresetAfterVerifiedSave
│   └── hooks.ts                # handleNativePresetChangeBefore / After / handlePresetRenamed / Deleted
├── apply/
│   ├── fail-closed.ts          # enterFailClosedState / rollbackCredentialOrFailClosed / rollbackStaleCredential / rollbackOrFailClosed / setCredentialSafetyBlock / clearCredentialSafetyBlock
│   ├── profile.ts              # applyProfile 拆解 → applyProxyProfile / applySecretProfile / verifyAndActivateSecret / finalizeApply
│   └── guard.ts                # guardGenerationWhenBlocked
├── profiles/
│   ├── crud.ts                 # createProfile / saveSelectedProfile / rename / copy / delete
│   ├── capture.ts              # captureNativeProfile
│   └── key-editor.ts           # saveAndBindInputKey / readBoundSecret / revealBoundSecret / copyBoundSecret
├── import/
│   └── native.ts               # credentialDescriptor / collectNativeImportCandidates / buildNativeImportPreview / resolveNativeImportCredential / importNativeProfile
├── models/
│   ├── fetch.ts                # fetchModelsForProfile 拆解 → fetchModelsFrontend / fetchModelsBackend / restoreSecretAfterFetch；fetchCustomModels / addCustomModel
│   └── manage.ts               # manageCustomModels 拆解 → createManagerDraft / renderRemotePanel / renderChosenPanel / handleRemoteAction / handleChosenAction / commitManagerDraft
├── ui/
│   ├── toolbar.ts              # toolbarHtml
│   └── render.ts               # renderProfiles / renderProfileEditor / renderModelControl / renderStatus / setStatus / updateCredentialEditor / clearKeyEditor / updatePanelVisibility / setOperationControlsDisabled
├── quick-actions/
│   ├── manager.ts              # manageQuickActions 拆解 → createQuickManagerDraft / renderActionList / renderActionEditor / handleManagerActions / commitQuickActions；chooseQuickActionPlacement
│   ├── options.ts              # presetOptionsHtml / profileOptionsHtml / modelSuggestionsForProfile
│   ├── runner.ts               # runQuickAction / queueQuickAction / applyProfileById / applyExplicitModel / selectPresetForQuickAction / waitForPresetAfter / findFormatForCurrentSource
│   └── menu.ts                 # openQuickActionMenu / closeQuickActionMenu / makeQuickActionEntry / ensureQuickActionEntries / scheduleQuickActionEntries / activeQuickReplyButtonContainer
├── events.ts                   # bindEvents（按域拆分绑定）+ eventSource 注册
└── lifecycle.ts                # init / restoreInitialProfileSelection / teardownQuickerApi / detectConflict / watchForDomChanges
```

## 依赖方向约束

- `render`（ui/render.ts）是叶子节点，禁止向上依赖 → 消除 import 环
- 纯函数模块（utils/domain）不依赖任何宿主全局 / DOM / jQuery
- 服务层只依赖宿主声明（st.d.ts）与纯函数，互不直接引用对方内部状态（通过 state.ts / settings 访问器）

## 巨石函数拆解清单

| 原函数 | 行数 | 拆解 |
|---|---|---|
| applyProfile | ~100 | proxy 分支 / secret 分支 / 激活校验 / 收尾 |
| manageCustomModels | ~200 | draft / remote panel / chosen panel / actions / commit |
| manageQuickActions | ~200 | draft / list / editor / actions / commit |
| fetchModelsForProfile | ~65 | 前端 /models / 后端 status / 密钥恢复 |
| saveSelectedProfile | ~50 | 校验 / 密钥绑定 / 原生同步 / 落库 |

## 测试计划（tests/，vitest）

覆盖全部纯函数模块 + 关键领域逻辑：

- utils/*（text、id、format、model-list、url、headers）
- domain/profile（normalizeProfile、uniqueName、profileMatchesNative、importIdentity、nativeImportFingerprint）
- domain/quick-action（normalizeQuickAction、placement、displayName）
- domain/status（editorHasUnsavedChanges、profileHasCredential）

修正现有损坏用例：`makeId` 测试正则 `/profile-\w{36}/` 不匹配含 `-` 的 UUID。

## 脚手架改动

- 删除当前损坏的 `src/utils.ts` / `src/index.ts` / `src/tests/utils.test.ts` 及 `dist/`
- `package.json` scripts：`build` / `watch` / `typecheck`(tsc --noEmit) / `test`(vitest run)
- 删除损坏的 eslint 脚本（reference 分支也无 eslint），以 typecheck 兜底
- 新增 `.gitignore`：`node_modules/`、`dist/`、`*.log`、`Thumbs.db`、`.DS_Store`
- `vite.config.ts`：`stResolver` 插件把 `@sillytavern/*` 重写为绝对路径并 external
- `tsconfig.json`：ESNext / strict / verbatimModuleSyntax / bundler resolution / noEmit / types: jquery+toastr+node

## 验收标准

1. `npm install` 成功（TS 7.0.2 / Vite 6 / Vitest 4 均可安装）
2. `npm run typecheck` 通过
3. `npm run test` 全绿
4. `npm run build` 产出 `dist/index.js`
5. `git rm index.js`（源码移交 `src/`），在 `refactor/ts-modular` 提交
6. 冒烟核对：dist 中 ST 导入保持 external 绝对路径

## 里程碑顺序

1. 脚手架 + 类型/常量/状态 + 纯函数 + 测试
2. 服务层（settings/secrets/fetch/popups/queue）
3. 原生交互（native/presets）
4. 核心流程（apply/profiles/import/models）
5. UI + 便捷方案
6. 入口/生命周期 + 验收
