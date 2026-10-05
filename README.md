# dsh-attention-notifier

DeepSeek Harness 插件：会话**任务完成**或**需要你批准/回答**时，若窗口在后台——

- 🔔 系统通知（静默 toast，点击聚焦窗口）
- 🔊 提示音（WebAudio 合成；批准急促三连音，完成舒缓两连音；可换成任意音频 URL/base64）
- ● 应用内等待角标（输入框停靠区 + 窗口标题 `(N)` 前缀）

防刷屏：同会话同类事件 2s 去重；完成类 10s 内超过 4 条聚合为一条；**批准/回答类永不聚合**。

## 工作原理（双层）

| 层 | 文件 | 职责 |
|---|---|---|
| Host（server 进程） | `index.js` + `fold.js` | 注册 `attention` 会话投影，折叠 `turn/start` `turn/end` `approval/asked` `approval/decided`（v44 SessionEventMap 规范事件，已对照 dsh-user-approval / dsh-agent-loop / dsh-session 源码核实） |
| Client（Web 渲染端） | `client.js` | 轮询 `sessions.list` 快照里的 `projectionValues.attention`，做状态迁移判定 → toast + 声音 + 角标 |

`turn/end` 的 `reason.kind`：`completed`=正常完成；`blocked`=智能体停在你面前等你回答（计时提问场景）；其余按异常类结束提醒。

## 安装

在目标 profile 里对 agent 说一句即可（bundle 需已含 `package.json + cordis.patch.yml`）：

> 用 plugin_manager 从本地目录 install_bundle：`<本目录绝对路径>`，然后激活到当前 profile。

或发布到 GitHub 后 `dsh plugin add github:<user>/dsh-attention-notifier`（建议挂 `dsh-plugin` topic）。

无 plugin_manager 时的等效手动安装（本机 desktop profile 实测足迹）：整包复制到 `<profile>/node_modules/@local/dsh-attention-notifier/`，并在 `<profile>/package.json` 的 `dsh.profile.bundles` 追加 `"@local/dsh-attention-notifier"`，重启 profile。注意手动测试副本用 `@local` 包名，发布版为 `@ahian-lee`——行为一致，正式安装请走上面两条路径之一。

## 验证记录（2026-10-05，desktop profile 静态实测）

- **挂载修复（已合入源码）**：cordis 插件是双 schema 语言层——`Config` 用 schemastery（`import z from '@deepseek-ai/schemastery'` 默认导出），投影的 `stateSchema`/`viewSchema` 用 zod（`import { z } from 'zod'`）。证据：v44 app.asar 核心包同时 `import z from "@deepseek-ai/schemastery"` 与 `import { z as z$1 } from "zod"`（dsh-agent/dsh-session），`turnBoundaryProjectionDefinition` 的 schema 全部 zod 构建。schemastery 没有 `.strict()/.nullable()/z.enum()/.int()`，初版 index.js 全命中并在挂载时抛 `z.object(...).strict is not a function`。发布节 §4 的 peerDependencies 记得把 `zod` 一并声明。
- **"唯一需实测确认的点"已静态排除白名单**：控制基线帧 wire schema 为 `projections: record(string(), unknown())`，`session.projections` 文档写明 "serves any registered projection key"，客户端 `projectionValues(sessionId)` 返回 store 全部值——非白名单。`attention` 实际到达仍以第 2/3 步体感为准。
- **事件词表复核通过**：`turn/end { turn, reason: TurnEndReason }`，`kind ∈ {completed, blocked, aborted, interrupted, error, max-tokens}`（`blocked` 由 preStep reject 真实发出）；`approval/asked { id, toolName, callId?, reason? }`；`apply(state, event)` 收 `{type, data}`。与 `fold.js` 假设一致。

## 安装后验证（3 步）

1. `cordis_inspect_query` 查 `sessionProjections`，应出现 `attention` 键；
2. 触发一次需要批准的任务（如让它跑一条需要审批的命令），把窗口切到后台 → 应听到三连音 + 收到 toast；
3. 跑完一轮任务 → 两连音 + "任务已完成" toast。

若投影键不存在或 `turn/end` 的 `reason.kind` 取值与本文不符，请以 `cordis_inspect_*` 实测为准并回填 `fold.js`（当前词表来自对 v44.0.0 app.asar 的源码核查）。

唯一需要实测确认的点：wire 视图随快照下发是否覆盖"全部已注册投影"——`dsh-api-session-controller/lib/client.js` 的 `projectionStores` 注释写着 "control or history baseline **supplied** projections"，若 `attention` 不在默认 supplied 集合里（快照读不到 `projectionValues.attention`），即为基线白名单，需要官方在 apps/desktop/协议层放开（记入 Discussions 帖的待确认项）。官方客户端 UI 的等价读法是 `useSessions(state => state.byId[id]?.projectionValues?.<key>)`（dsh-client-ui-agent-preset 实测用法），本插件用 `sessions.list.getSnapshot()` 轮询是因为 client 插件面无公开订阅 hook。

## 配置

Host 开关（`cordis.patch.yml` 行内 config，见本包示例）：
`notifyApproval` / `notifyQuestion` / `notifyCompletion` / `notifyFailedTurn`，四者独立。

Client 调参（`client.js` 顶部 `TUNABLES`，v0.1 为常量，配置打通是后续官方层能力）：
`notifyMode`（never|background|always）、`pollMs`、`dedupeMs`、`aggregateAfter`、
`soundUrls.done` / `soundUrls.alert`（填任意 wav/mp3 的 URL 或 `data:audio/wav;base64,...` 即替换默认音色；`tools/gen_sounds.cjs` 可再生同风格 wav，`sounds/sounds-b64.json` 已备好两者的 base64）。

## 已知边界（对应"官方层"待办，见设计提案 §5）

- **任务栏橙色 OverlayIcon / 黄条闪烁 / 通知点击直达会话**需要 Electron 主进程能力，插件层到不了——走 apps/desktop 参考 patch（提案 §6 的 `DesktopAttention` + preload 桥）。
- 会话快照走 1.5s 轮询（`sessions.list` 无公开订阅面）；声音/聚合参数未接配置服务。
- toast 权限默认在 Electron 内即 granted；系统通知中心被关时仍会有声音与角标。

## 测试

`node test/fold.test.js` —— 折叠与视图推导 9 组断言，零依赖。

## 发布到 GitHub + awesome-dsh-plugin 市场清单

**前置（评审硬条件）**：先在本机 profile 装上并完成上面「安装后验证」3 步——评审第 1 条就是"代码是否与声明一致"，且描述里的每个词都会被对着代码核。

包名已定稿 `@ahian-lee/dsh-attention-notifier`（`package.json` / `cordis.patch.yml` / `client.js` 模块 id 三处一致），投稿文件 `ahian-lee__dsh-attention-notifier.yml` 已按市场规范备好。建仓与推送：

```powershell
gh repo create ahian-lee/dsh-attention-notifier --public --source . --push
gh api -X PUT repos/ahian-lee/dsh-attention-notifier/topics -f 'names[]=dsh-plugin'
```

1. 发 npm 时才需要：删 `"private": true`（`repository` 字段已补，市场 npm 关联靠它）；只走 GitHub 安装则 `private` 可留。
2. 建仓库后加 **`dsh-plugin` topic**（上面第二条命令）；**仓库创建满 1 天**才能投（CI 自动查）。
3. 官方包已按本机捆绑值声明 `peerDependencies`（schemastery ^3.18.4 / cordis ^4.0.4 / zod ^4.6.5——投影 schema 用 zod，见「验证记录」第一条）。注意 node-semver 预发布坑：将来 harness 捆绑 rc 预发布版时，peer range 必须带显式 `|| >=<tuple>-rc.x` 分支，否则用户 ERESOLVE。
4. 投稿 = 往 awesome-dsh-plugin 的 `data/plugins/` 加**一个** yml（本包根的 `ahian-lee__dsh-attention-notifier.yml` 直接复制，category `notify`）；README 由脚本生成不要手改；描述含 `: ` 必须加引号。
5. 截图（可选但推荐）：本包根放 `screenshots.json`（1–8 张相对路径），拍「toast+角标」「批准 toast」两张最佳。
6. 可选 tarball：`npm pack` 产物附到 GitHub Release，资产名**不要带版本号**（`latest/download/` 按字面取文件名，带版本必 404 烂链）。
