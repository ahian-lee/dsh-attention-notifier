# 开发说明

本页面向需要修改插件、排查安装问题或向插件市场投稿的开发者。

## 结构

| 文件 | 作用 |
|---|---|
| `index.js` | 注册 `attention` 会话投影及插件配置 |
| `fold.js` | 根据会话事件推导运行、等待批准、等待回答和结束状态 |
| `client.js` | 监听会话快照，触发声音、系统通知及可选桌面桥接 |
| `cordis.patch.yml` | 插件加载与配置 |
| `overlay/` | Windows 任务栏与原生通知的本地补丁 |

Host 将 `turn/start`、`turn/end`、`approval/asked`、`approval/decided` 折叠为 `attention` 投影，Client 从会话快照中的 `projectionValues.attention` 读取它。

插件配置使用 `@deepseek-ai/schemastery`，投影的状态和视图 schema 使用 `zod`；两者不能互换。此前安装失败曾由混用这两种 schema 导致。

## 事件与提醒行为

- `turn/end` 的 `reason.kind === 'completed'` 表示正常完成。
- 当前“等待回答”的识别依据是 `reason.kind === 'blocked'`，并不表示插件能够识别所有界面提问。
- 除 `completed` 与 `blocked` 外的结束类型，按异常结束处理。
- 同一会话的同类提醒在 2 秒内去重。
- 10 秒内完成事件超过 4 条后，后续完成提醒使用聚合形式；此前已发送的提醒不会收回。批准与回答提醒不参与完成事件聚合。
- 加载后 2.5 秒内记录状态但不播放历史事件提示音或发送弹窗。
- 会话快照支持订阅时优先订阅，同时每 1.5 秒轮询。轮询仍受后台计时限制影响。

这些参数位于 `client.js` 顶部的 `TUNABLES`。

## 排查安装问题

1. 用 `cordis_inspect_query` 检查 `sessionProjections` 中是否注册了 `attention`。
2. 检查客户端快照是否包含 `projectionValues.attention`。
3. 分别触发批准、等待回答、正常完成，检查声音与后台通知。

原 README 曾同时保留“静态检查未发现投影白名单限制”和“是否存在白名单仍待确认”两种说法。应区分源码检查与端到端运行结果：静态检查不能代替当前版本客户端实际收到投影的验证。

## 测试

```sh
node test/fold.test.js
```

该测试覆盖事件折叠和视图推导，不验证音频、系统通知、任务栏角标或具体 DSH 版本的安装兼容性。

## Windows 补丁文件

| 文件 | 作用 |
|---|---|
| `apply-attention-overlay.ps1/.cmd` | 安装补丁，支持指定应用目录 |
| `restore-attention-overlay.ps1/.cmd` | 检查目录标记后还原 |
| `asar-extract.mjs` | 解包应用归档，合并 unpacked 文件并检查路径 |
| `make-injections.mjs` | 生成主进程与 preload 桥接代码 |
| `patch-app-dir.mjs` | 插入或移除补丁代码，`--revert` 用于移除 |
| `gen-badges-white.ps1` | 生成数字图标 |
| `badges/badges-b64.json` | 数字 1–9、9+ 的图标数据 |

## 投稿与发布

插件包名为 `@ahian-lee/dsh-attention-notifier`，仓库包含用于 awesome-dsh-plugin 投稿的 `ahian-lee__dsh-attention-notifier.yml`。

投稿前，在目标 profile 验证实际行为。市场描述应明确：任务栏提醒依赖可选 Windows 补丁，普通通知受运行环境和权限影响。

原发布记录列出的市场要求包括：公开仓库、`dsh-plugin` topic、仓库创建满一天，以及向 `data/plugins/` 添加一个 YAML 文件。投稿时请核对市场当前规则；市场 README 由脚本生成。

只通过 GitHub 安装时可保留 `private: true`；发布到 npm 前需要取消该设置，并确认发布包包含运行所需文件。当前 `index.js` 引用了 `fold.js`，但 `package.json` 的 `files` 列表未包含它，不能仅取消 `private` 后直接发布。

如果需要支持依赖的预发布版本，请检查 peerDependencies 的版本范围是否接受实际捆绑版本。

## 版本记录

- **v0.2.0**：加入 Windows 补丁套件；完成数量角标保持到用户返回窗口；启动时抑制历史事件提醒。
- **v0.1.x**：移除页面内角标与标题前缀；默认前后台播放声音；使用订阅与轮询读取会话变化。
