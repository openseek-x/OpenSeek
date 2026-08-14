# @deepseek-ai/dsh-client-ui-desktop-update

[English](README.md) | 中文

桌面版更新偏好与展示插件。Host 半边只注册 `desktop-update` 设置 namespace，并把 `policy` 默认设为 `background`；它不会增加 Cordis Context 服务。Electron 主进程从通用设置服务读取解析后的策略，并观察 `settings/updated`。浏览器半边通过 `ctx.settingsScope` 绑定同一 namespace，随后向 `settings.general.item` 贡献策略与状态行，并向 `shell.overlay` 贡献可关闭的非模态提示。

浏览器半边只用于 Desktop patch。它在激活时要求存在经过 context isolation 的 `globalThis.dshDesktopUpdate` bridge，bridge 缺失时会明确失败。默认 Web 组合不会挂载本插件；`dsh-web-app` 携带本包，只为让覆盖该 bundle 的 Desktop patch 能解析它的客户端模块。

## 检查策略

| `policy` | Electron 行为 |
|---|---|
| `background` | 打包应用启动后检查，并按配置的间隔继续检查。 |
| `startup` | 启动后只检查一次。 |
| `manual` | 仅在用户明确操作后检查。 |
| `disabled` | 停止计划检查，同时保留用于重新启用的设置。 |

主进程始终拥有 `disabled`、`idle`、`checking`、`available`、`downloading`、`ready` 与 `error` 状态的权威数据。渲染器可以请求 `check`、`download`、`install` 或 `open-release`，但永远无法访问 updater 或文件系统。下载与重启都需要用户明确操作。后台检查的无更新结果与错误只保留在设置行中，手动检查和可操作的更新状态还可以出现在 overlay 中。

每个主进程状态都带有单调递增的 `revision`。渲染器先订阅事件，再请求初始快照；如果回复不比已经观察到的状态新，就会拒绝该回复，因此 IPC 回复无法把界面回退到中途事件之前。preload 会验证每个快照，包括策略、进度范围、ISO 时间戳以及 HTTPS `github.com/<owner>/<repo>/releases` URL，然后才把它交给本包。

## 模型体验

无，因为桌面版更新设置与提示属于应用界面；本包中的任何内容都不会进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **仅限 Desktop 组合** —— 在没有 Electron preload bridge 的情况下挂载浏览器半边会使激活失败；普通浏览器部署必须省略本插件。
- **Linux 不支持原地更新** —— Electron owner 会把 Linux 压缩包报告为不受支持，因此本包会提供可信的 Releases 页面，而不是下载与安装控件。
- **关闭状态仅在本次会话有效** —— 关闭某一更新阶段后，同一版本后续的进度 revision 仍会保持隐藏；下载完成等阶段变化会重新出现提示。组件重新挂载时关闭状态会重置，且不会跨应用重启持久化。
