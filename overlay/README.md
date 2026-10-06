# Windows 任务栏提醒（可选补丁）

搭配 DSH Attention Notifier，为 Windows 桌面版增加：

- **任务栏数字**：显示等待你处理的会话数量；任务完成后也会留下数字，直到你回到窗口。
- **图标闪烁**：窗口在后台或最小化时，提示有会话需要你处理。
- **原生系统通知**：点击通知即可唤起 DSH 窗口。

不安装此补丁也可以使用插件的声音提醒；普通系统通知是否可用取决于运行环境。

## 安装

1. 完全退出 DeepSeek Harness，包括右下角托盘中的应用。
2. 双击此目录中的 `apply-attention-overlay.cmd`。首次处理可能需要几分钟。
3. 看到 `PATCH APPLIED` 后重新打开 DSH。
4. 如果系统通知没有出现，检查 Windows“设置 → 系统 → 通知”中是否允许 DeepSeek Harness 发送通知。

安装目录不是默认位置时，可以指定目录：

```powershell
powershell -File apply-attention-overlay.ps1 -AppRoot "D:\你的目录"
```

## 还原与更新

完全退出 DSH 后，双击 `restore-attention-overlay.cmd` 还原。

**更新 DSH 前，请先还原补丁；更新后再按需安装。** 补丁会让应用从解包后的目录加载，若保留该目录，应用更新后可能仍运行旧版本。

还原脚本会检查自己创建的目录标记，再删除补丁目录；原始应用归档会恢复原名。

## 为什么需要补丁？

当前插件没有直接调用桌面主进程的任务栏和原生通知接口。本补丁通过一个本地桥接接口，把这些能力提供给插件。

它会解包应用、修改解包后的启动文件，并将原始 `app.asar` 改名保存。原始归档的内容保持不变，但应用的加载方式会改变。

这是临时的本地定制，应用的打包方式变化后可能需要调整。官方提供对应能力后，就可以移除补丁。

相关建议：[Discussion #9003](https://github.com/deepseek-ai/deepseek-harness/discussions/9003)。
