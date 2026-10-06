# overlay/ — 可选 Windows 任务栏补丁（数字角标 + 原生 toast）

插件本体（声音 + 应用内逻辑）在**任何环境都完整工作**。本目录是可选的本地补丁套件，
给 DeepSeek Harness 桌面版补上三个渲染进程拿不到的原生能力，装完后 `client.js` 会通过
`window.dshAttentionLocal` 桥自动使用它们：

| 能力 | 效果 |
|---|---|
| `setOverlayIcon` | 任务栏图标右上角**白底黑字数字**（等待批准/回答时持久显示；任务完成时挂数字，直到你打开窗口才清） |
| `flashFrame` | 有会话在等你且窗口在后台/最小化时，任务栏图标闪烁 |
| 原生 `Notification` | Windows 通知中心 toast（渲染进程 HTML5 Notification 在 Electron 里经常静默失效，主进程原生通知可靠），点击 toast 唤起窗口 |

**没有这个补丁，插件照常出声、出 toast（尽力而为）、做状态跟踪——只是任务栏没有数字。**

## 原理（全部可逆，不碰原文件）

- Electron 的加载顺序是 `resources\app\` 目录**优先于** `resources\app.asar`。补丁把 asar
  完整解包成 `resources\app\`（合并 unpacked），只在 `lib/main.js` 与 `lib/preload-app.cjs`
  **末尾追加**两段带标记注释（`// ==== <dsh-attention-overlay patch v2> ====`）的独立代码，
  然后把 `app.asar` 改名为 `app.asar.orig`——**原始 asar 一个字节都不改**，回滚=改名回来。
- 实测该发行版 Electron fuse：`enableEmbeddedAsarIntegrityValidation=0`、
  `onlyLoadAppFromAsar=0`，影子目录方案合法生效。
- 注入块支持多版本原位剥离（`patch-app-dir.mjs --revert`），升级补丁无需重新解包。

## 使用

1. **完全退出** DeepSeek Harness（包括右下角托盘 → 退出）。
2. 双击 `apply-attention-overlay.cmd`（首次解包约 1–3 分钟）。
   安装位置不是默认时：`powershell -File apply-attention-overlay.ps1 -AppRoot "D:\你的目录"`。
3. 看到 `PATCH APPLIED` 后重新打开应用。配合本插件即得全套通知。
4. 若 toast 仍不出现：Windows 设置 → 系统 → 通知 → 允许 "DeepSeek Harness"。

## 回滚

完全退出应用后双击 `restore-attention-overlay.cmd`。删除前会校验
`resources\app\.attention-overlay.json` 标记——不是自己创建的目录绝不动。

## 注意

- **应用自动更新**：更新器只替换 `app.asar`，不会删 `resources\app`——更新后应用仍在跑
  影子目录里的旧版本。想吃到更新：先 restore，更新完再按需重新 apply。
- 补丁是**用户自愿的本地定制**；官方若提供一等 API（见 deepseek-ai/deepseek-harness
  Discussions 的功能请求），本目录即可退役。

## 文件

| 文件 | 作用 |
|---|---|
| `apply-attention-overlay.ps1/.cmd` | 一键打上（`-AppRoot` 可指定安装目录） |
| `restore-attention-overlay.ps1/.cmd` | 一键还原（校验自建标记） |
| `asar-extract.mjs` | 全量解包器（unpacked 合并、link 处理、越界路径校验） |
| `make-injections.mjs` | 由 `badges/badges-b64.json` 生成两段注入代码到 `injections/` |
| `patch-app-dir.mjs [--revert]` | 幂等注入 / 多版本剥离 |
| `gen-badges-white.ps1` | 用 GDI+ 重新生成 10 张白底黑字数字 PNG（改配色时用） |
| `badges/badges-b64.json` | 白底黑字数字 1–9、9+（64px PNG base64） |
