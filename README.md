# DSH Attention Notifier

**任务完成了，或 DSH 正在等你批准、回答时，提醒你回来看看。**

让 DSH 处理任务时，你可以切到其他应用。这个插件用不同的提示音区分“任务完成”和“需要你处理”，窗口在后台时还会尝试发送系统通知。

Windows 桌面版可搭配[可选补丁](overlay/README.md)，增加任务栏数字角标、图标闪烁和原生系统通知。

## 有哪些提醒？

| 时刻 | 插件提供 | 安装 Windows 补丁后增加 |
|---|---|---|
| 等待批准 | 较急促的三声提示音；后台系统通知 | 等待会话数量角标、任务栏闪烁 |
| 等待回答 | 较急促的三声提示音；后台系统通知 | 等待会话数量角标、任务栏闪烁 |
| 任务完成 | 较舒缓的两声提示音；后台系统通知 | 完成数量角标，回到窗口后清除 |

默认前台和后台都会播放声音，系统通知只在窗口处于后台时发送。提醒根据会话状态变化触发，并对重复事件做去重。

## 安装

通过 DSH 命令行安装到所需 profile：

```sh
dsh plugin add github:ahian-lee/dsh-attention-notifier
```

也可以下载仓库后，让 DSH 帮你安装：

> 请用 plugin_manager 的 install_bundle 从本地目录 `<仓库绝对路径>` 安装此插件，并激活到当前 profile。

安装后重启对应 profile。Windows 任务栏提醒需要另外安装[可选补丁](overlay/README.md)；只需要声音时可以跳过。

## 试一下

1. 安装后，先在 DSH 窗口内点击一次，允许音频开始播放。
2. 让 DSH 执行一个需要你批准的任务，再切到其他应用，检查提示音和系统通知。
3. 让一轮任务正常完成，检查完成提示音。

装了 Windows 补丁后，也可以检查任务栏数字和闪烁。点击原生系统通知会唤起 DSH 窗口。

## 设置

提示音现在直接在 DSH 里换：**更多 → 设置 → 插件 → Attention Notifier**。

- "等待处理时"和"任务完成时"各自独立选择提示音。
- 内置 4 种合成音色：经典、轻柔、电玩、钟铃，点一下就切换并试听。
- 内置猫咪 hachimi 音效（见下）。
- "选择音乐…"可以换成你自己电脑上的任何音频文件（5MB 以内），换完立即生效，重启不丢。
- 卡片上会显示当前两个时刻分别用的是什么声音。

可以在 `cordis.patch.yml` 中分别开关批准、回答、完成和异常结束提醒：

- `notifyApproval`
- `notifyQuestion`
- `notifyCompletion`
- `notifyFailedTurn`

进阶选项在 `client.src.js` 顶部的 `TUNABLES`（改完跑一次 `node build/gen-builtin-sounds.mjs` 重新生成 `client.js`）：

- `notifyMode`：`always`（默认，前后台出声）、`background`（仅后台出声）或 `never`（停用声音与弹窗）。任务栏补丁的角标由会话状态单独驱动。

## 内置猫咪 hachimi 音效（just for fun）

我们加入了猫咪 hachimi 音效，just for fun：

| 什么时候响 | 曲目 |
|---|---|
| 任务完成 | Blue Lotus · North South · Mambo |
| 等待你批准 | Neige · Electric Neige |

音频文件在 `sounds/hachimi/`，想换成自己的音乐：把 MP3 丢进这个目录跑 `node build/gen-builtin-sounds.mjs`，或者更简单——直接在设置页面里"选择音乐…"。

## 使用说明

- 不安装补丁时，系统通知取决于运行环境和通知权限，在部分 Electron / Windows 环境下可能无法显示。
- 音频可能需要先在窗口内点击或按键，才能在后台播放。
- 插件优先订阅会话变化，不支持订阅时使用轮询；后台窗口的计时限制可能使提醒延迟。
- Windows 补丁是临时方案。**更新 DSH 前请先还原补丁**，更新后再按需安装，详见[补丁说明](overlay/README.md)。

本插件在 DSH 官方插件专区的展示与反馈帖：[Discussion #9003](https://github.com/deepseek-ai/deepseek-harness/discussions/9003)。

开发、排查问题和投稿信息见[开发说明](docs/development-notes.md)。
