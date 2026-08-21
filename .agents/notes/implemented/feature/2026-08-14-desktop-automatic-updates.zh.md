# Agent Note: 通过 GitHub Releases 实现桌面自动更新

Status: implemented

[English](2026-08-14-desktop-automatic-updates.md) | 中文

## Problem

打包后的桌面应用没有一条从已安装版本前往后续 Release 的受控路径。查找 Release、选择正确架构、替换运行中的应用以及保护 Host 工作全都留给用户处理。只增加一次网络检查并不能解决生命周期问题：更新 feed 身份、下载确认、平台产物身份、关停顺序与发布完整性必须一致，否则应用可能提供不完整或方向错误的升级。

## Decision

Electron 主进程持有一个由 GitHub Releases 支持的 `electron-updater` 控制器。构建时资源固定仓库与通道，只在正式 Release 包中启用更新，并携带有界的调度值。运行时解析会拒绝格式错误的仓库片段、通道名、延迟与 Release URL。Feed 在运行时不使用 GitHub token，控制器还会拒绝预发布版本与降级。

`@deepseek-ai/dsh-client-connection` 持有共享的 `DesktopUpdatePolicy`、操作、状态与 preload 桥协议及其 IPC 解析器，因此 Electron 主进程、preload 与 renderer 会使用同一份进程无关定义，无需导入 UI aggregate。`@deepseek-ai/dsh-client-ui-desktop-update` 注册 `desktop-update` namespace 及其持久 `policy` 字段与仅用于 Desktop 的 renderer 界面，但不增加 Cordis Context 服务。Electron 主进程通过通用设置服务读取解析后的策略，并把 `settings/updated` 事件适配给本地更新控制器。策略只能是 `background`、`startup`、`manual` 或 `disabled`，默认值为 `background`。`background` 会在启动延迟 30 秒后检查，并在此后每四小时检查一次；`startup` 会在延迟后检查一次；`manual` 只在用户操作后检查；`disabled` 会停止后续检查。主进程发布带修订号的封闭状态机：`disabled`、`idle`、`checking`、`available`、`downloading`、`ready` 与 `error`。后台检查得到「已是最新版本」或错误时保持安静；手动结果与可操作版本会显示在非模态 `shell.overlay` 提示和「通用设置」行中。

`autoDownload` 与 `autoInstallOnAppQuit` 均被禁用。发现 Release 后会公开下载操作；进入 `ready` 后再公开独立的重启并安装操作。禁用后续检查不会撤销已经可用或下载完成的更新。普通应用退出绝不会意外安装更新。

## Lifecycle and platform support

应用会在启动 Host 前取得单实例锁，因此只有一个进程持有更新器状态与缓存。Signal、窗口退出、启动失败、profile 内的 `appExit` 和请求安装都会汇入同一个关停协调器。Desktop 会选择 `{ kind: 'caller' }` profile 生命周期：`attach` 会在 profile boot 可能让出执行权前提供带时间上界的关停，`requestExit` 则把 `appExit` 交给 Electron。启动期间发起的关停会等待 profile Context 发布后再释放它，并阻止余下的更新器、IPC 与窗口 bootstrap；该控制器绝不会改变进程退出状态。安装流程会停止更新器调度并中止活动应用工作；本地 cleanup 失败会被报告，但后续 cleanup 与 Host 完全停稳仍会继续。错误报告属于 best-effort，不能中断该序列。只有 cleanup 与 Host 完全停稳都成功后，才会调用 `quitAndInstall(false, true)`。随后 Desktop 会在构建时固定的 2 分钟上限内等待原生 `before-quit-for-update` 确认。Cleanup 失败、资源释放失败或完全停稳超时会阻止安装器调用；交接错误或确认超时会使 Electron 以非零状态退出。第二次退出请求会加入同一个 Promise，不会开始并行 teardown。

官方 macOS 与 Windows 包支持原地更新。Mac 包只会在应用位于 `/Applications` 或当前用户的 `Applications` 目录时运行更新器。Arm64 使用通道 `latest-arm64` 与文档 `latest-arm64-mac.yml`；x64 使用 `latest-x64` 与 `latest-x64-mac.yml`，因此并发 Release job 不会用一个架构的通道文档覆盖另一个。Windows x64 使用 `latest.yml` 与 NSIS `.exe.blockmap`。Linux `.tar.gz` 没有通道文档或安全的替换安装器，因此其状态为 `disabled`、原因为 `unsupported-platform`，「设置」操作会打开固定的 GitHub Releases 页面供用户手动安装。

首个启用更新的 Release 是需要用户手动安装的 seed 版本；下一个更高 Release 才是第一份能够验证原地路径的版本。回滚会使用另一个更高的 patch Release，而不是降级。这样能保持版本顺序单调，并避免客户端在一次受攻击或有缺陷的 Release 后重新接受较旧产物。

## Trust and publication

Context-isolated preload 只公开状态读取、状态观察以及封闭的 `check`、`download`、`install`、`open-release` 操作集合。它的 CommonJS 产物会内联进程无关的 connection 解析器，而不会在运行时 require 该包的 ESM 子路径。主进程会使用与其他特权 IPC 相同的所属窗口、顶层 frame 与 `dsh://app` 检查来校验发送方。Renderer 会在渲染前解析每个 structured-clone 状态，拒绝陈旧修订号，并且只接受构建时固定的 HTTPS `github.com/<owner>/<repository>/releases` 路径。只有主进程能通过操作系统浏览器打开该页面，并持有全部更新器网络与安装器调用。

Release 打包会在分发产物旁加入 Electron Builder 通道元数据与完整性 hash。工作流只把标签推送归类为 Release 构建，并单独校验版本控制中的签名模式。当前[无证书 Release 模式决策](../process/2026-08-15-certificate-free-desktop-release-mode.zh.md)会选择无证书模式，并单独把发布限制在 `dsh-v0.1.4`：Mac 应用使用一个稳定的 ad-hoc designated requirement，不具备 Developer ID 身份认证或 notarization；Windows 应用与 NSIS 安装程序不带签名，并省略 `publisherName`。手动运行使用相同的无证书包校验，但绝不会发布。只有显式 `signed` 模式才会注入签名与 notarization secret，把 Windows 证书的完整 X.509 Subject 推导到 `publisherName`，并在缺少任一必需凭据或发布者身份时失败；缺少 secret 绝不会选择无证书模式。

最终发布 job 会绑定 `desktop-release`；对于无证书 `0.1.4`，它不引用签名 secret，也不要求人工审批。无证书 Mac 与 Windows 打包 job、Linux 打包 job 和手动 job 会绑定不含 secret 的 `desktop-package` Environment。选择 `signed` 前，维护者需要为 `desktop-release` 配置 required reviewers、禁止 self-review 与绕过保护规则、选定的 `dsh-v*` Tag deployment rule 以及全部 Apple 和 Windows 签名与 notarization secret，且不得在 repository 或 organization 层级保存副本。届时 signed 模式的 Mac 与 Windows job 会绑定该 Environment，仓库 ruleset 也会限制 `refs/tags/dsh-v*` 的创建并阻止更新与删除。

Release 标签必须严格采用 `dsh-vX.Y.Z`，并等于稳定的 `X.Y.Z` 桌面包版本；预发布版本会在打包前被拒绝。每个 Mac 或 Windows 打包 job 都会在上传产物前解析生成的更新文档，并验证准确的平台文件集合、主路径、大小与 SHA-512 digest。全部原生构建与打包冒烟 job 完成后才能发布。发布方会校验一套完整、无重复的跨平台产物，写入 `SHA256SUMS`，创建草稿 GitHub Release，上传每个安装程序、压缩包、更新文档与 blockmap，并且只在所有上传成功后把草稿转为公开 Release。该标签下的 Release 一旦公开便不可变：重新运行工作流会失败，而不是接受或替换其中的产物。因此，校验或上传失败无法暴露公开的不完整通道。

## Verification

控制器测试约定策略采用、调度、状态转换、安静的后台结果、显式下载、干净关停委托、重复后端错误抑制与资源释放。调用方持有的关停测试约定成功完全停稳、资源释放 reject、超时 reject、同步重入请求合并，以及不会产生进程退出影响。Connection 协议与 UI 客户端控制器测试约定 IPC 校验和陈旧修订号拒绝；展示转换器与 slot 组合测试约定两个可见界面。打包桌面冒烟测试会进入真实 `dsh://app` 组合，验证更新器桥返回有效状态，再通过 `--inspect=0` 打开的、仅绑定本机回环地址的主进程 inspector 求值 `process.emit('SIGTERM')`。该方式会直接执行已注册的信号关停路径，不会进入 Chromium 的浏览器关闭生命周期。子进程必须在 5 秒内触发 `close`，并满足 `exitCode === 0` 与 `signalCode === null`，同时主进程需要在 cleanup 与 Host 完全停稳成功后写出 `dsh desktop: shutdown quiesced` 标记；`SIGKILL` 只用于失败后的清理。Release 工作流还会在发布前独立检查稳定版本／标签相等性、原生打包、精确产物数量、feed 路径、大小与 SHA-512 相等性、checksum，以及已发布 Release 不可变性。

每种容器格式的安装与卸载、通过公开 GitHub Release 完成两个真实版本之间的更新、接收方机器上的操作系统信任提示，以及平台安装器内部中断后的恢复仍是覆盖缺口。Seed Release 及其下一个 Release 是完整更新路径的生产验证。

## Alternatives considered

**使用 Electron 裸 `autoUpdater` 并在本地维护提供方逻辑。** Electron API 无法为随附的 DMG／ZIP 与 NSIS 格式提供一套一致的 GitHub 元数据、下载进度和打包集成。`electron-updater` 会消费 Electron Builder 已经生成的元数据，删除原本需要仓库自行持有的提供方与安装器编排。

**在后台下载每个更新并在退出时安装。** 这能减少点击次数，但会在未经确认时消耗带宽，也会让一次普通退出改变已安装应用。显式下载与安装操作会让两项影响都可见，并且只给 Host 关停协调器留下一条有意的安装路径。

**从 renderer 或共享 Web 插件检查 GitHub。** 这会把 feed 选择或网络权限交给不受信客户端代码，还会给浏览器部署加入桌面 Release 行为。基于主进程控制器的 Desktop 专用展示插件会把平台权限留在 renderer 之外，同时复用现有 slot 与「设置」系统。

**每个平台 job 完成后立即发布其产物。** 用户与更新器客户端可能看到缺少架构、元数据或 blockmap 的 Release。草稿是暂存事务；精确集合校验与最后一次发布操作使完整性成为 Release 不变量。

**允许 Linux 从 `.tar.gz` 原地替换。** 该压缩包没有安装根目录、包管理器所有权或原子交换机制。打开附有 checksum 的已发布 Release 页面供手动安装能如实表达限制；Linux 原地更新需要未来具备自身生命周期决策的安装器格式。

**允许降级以便回滚。** 这能让已知旧构建重新可达，但也会削弱单调版本选择，并让旧更新元数据持续与安全相关。更高 patch Release 可以在不改变客户端信任规则的情况下恢复所需代码。

## Consequences

Mac 与 Windows 用户会获得持久更新策略、安静的定期检查、显式下载，以及仅在 Host 完全停稳后执行的安装。更新器无法从 renderer 输入静默重定向 feed，浏览器产品不会获得更新行为，公开 GitHub Releases 只会携带一套完整产物，其中选定的 Mac 与 Windows 签名状态已经过校验。该能力不会增加任何模型可见的提示词、消息、工具、schema 或提供方请求内容。

代价是按架构拆分的 Mac 通道、seed Release 引导、更大的 Release 产物集合、一个额外的主进程长生命周期状态机，以及选择无证书模式期间的操作系统信任警告。Linux 用户仍需手动安装更新，普通本地包无法运行已启用的 feed，而对平台替换的完整信心需要观察 seed 版本到下一个版本的 Release 组合。切换到 signed Release 还需要平台签名与 notarization 基础设施。
