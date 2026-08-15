# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

DeepSeek Harness 图形客户端的 Electron 应用。主进程在进程内启动随附的 `web` profile，应用 `config/desktop.patch.yml` 以替换 HTTP 服务器和仅浏览器使用的条目，再打开与 `dsh web` 相同的已构建客户端组合。因此，renderer（渲染器）无需本机端口即可保留 Web 产品的 Session、设置、模型选择、工具和插件 UI。

构建后的前端与客户端插件 bundle 由安全的 `dsh://app/` 应用 origin 提供。Unary API 与通用 RPC 请求以 structured-clone 元数据和字节穿过 context-isolated preload 桥；两条事件通道通过同一桥流式传输分块。主进程把这些 Fetch 形式的请求分发给 `HostConnectionService`，因此 Host API 仍只有一份实现。目录选择与 Session 日志导出使用原生对话框。一个仅用于 Desktop 的插件会加入更新偏好设置和非模态更新提示，不改变浏览器组合。

## 运行与打包

在仓库根目录执行：

```sh
pnpm run desktop
pnpm run package:desktop
pnpm run test:desktop:packaged
```

`desktop` 会构建仓库并从源码启动 Electron。`package:desktop` 面向当前宿主与架构构建，在 macOS 与 Windows 上于 `dist-desktop/DeepSeek Harness-<platform>-<arch>/` 下组装独立应用，在 Linux 上则使用 `dist-desktop/DeepSeek-Harness-linux-<arch>/`，并生成对应平台的分发文件：

- macOS：`dist-desktop/installers/DeepSeek-Harness-<version>-mac-<arch>.dmg` 与 `.zip`
- Windows：`dist-desktop/installers/DeepSeek-Harness-<version>-win-<arch>.exe` 及其 `.blockmap`
- Linux：`dist-desktop/installers/DeepSeek-Harness-<version>-linux-<arch>.tar.gz`

Mac 打包还会在对应架构旁生成 `latest-arm64-mac.yml` 或 `latest-x64-mac.yml`，Windows x64 打包则会生成 `latest.yml`。这些文档位于禁用更新器的本地包中也不会产生影响；Linux 不生成通道文档。

`test:desktop:packaged` 会启动组装后的应用，通过随机的本机 Chromium 调试端口等待完整界面组合完成，并检查可见内容、更新桥与协调关停。界面检查完成后，它会通过 `--inspect=0` 打开的、仅绑定本机回环地址的主进程 inspector 求值 `process.emit('SIGTERM')`，直接执行已注册的信号关停路径。子进程必须在 5 秒内触发 `close`，并满足 `exitCode === 0` 与 `signalCode === null`；捕获的输出还必须包含 `dsh desktop: shutdown quiesced`，该标记只会在主进程 cleanup 与 Host 完全停稳成功后写出。超时时只会使用 `SIGKILL` 清理进程，测试仍然失败。[Desktop packages](../../.github/workflows/desktop-packages.yml) 会针对 macOS arm64 与 x64、Windows x64 和 Linux x64 执行原生构建与冒烟测试，再把各安装程序或压缩包上传为工作流产物。Release 标签采用 `dsh-vX.Y.Z`，且必须与稳定的 `X.Y.Z` 桌面 manifest 版本完全一致；预发布版本会被拒绝。工作流会在版本控制中声明一个封闭的 Release 签名模式。当前模式是 `certificate-free`，另一个经过审查的标签设置会把发布限制在 `dsh-v0.1.1`；任何其他标签都会失败，直到模式或审查标签被显式修改。每个 Mac 或 Windows job 都会在上传前解析更新文档，并验证准确的产物路径、大小、SHA-512 digest 与所选签名状态。发布 job 随后校验完整的跨平台产物集合与 checksum，把它们上传到草稿 GitHub Release，并且只在所有上传成功后发布该草稿。已发布标签不可变：为其重新运行工作流会失败，而不是接受或替换现有公开 Release。手动运行使用无证书打包，只保留外层带 ZIP 且有效期为 14 天的工作流产物，不会发布 Release。

每个最终发布 job 都会绑定 `desktop-release`。对于无证书 `0.1.1` Release，该 Environment 不提供签名 secret，也不要求人工审批；无证书、手动与 Linux 打包 job 使用单独且不含 secret 的 `desktop-package` Environment。选择 `signed` 前，需要为 `desktop-release` 配置 required reviewers、禁止 self-review 与绕过保护规则、选定的 `dsh-v*` Tag deployment rule 以及签名 secret，并保护 `refs/tags/dsh-v*`，禁止未授权创建、更新或删除。届时 signed 模式的 Mac 与 Windows job 也会绑定 `desktop-release`。

只有当工作流的 Release 签名模式为 `signed` 时，才会读取 `MACOS_CERTIFICATE_BASE64`、`MACOS_CERTIFICATE_PASSWORD`、`MACOS_SIGN_IDENTITY`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`、`WINDOWS_CERTIFICATE_BASE64` 与 `WINDOWS_CERTIFICATE_PASSWORD`；届时这些值只能作为 `desktop-release` Environment secret 存在，不得在 repository 或 organization 层级保存同名副本。Signed 模式缺少凭据时会失败，不会因此选择无证书打包。

从终端启动时，终端当前目录是初始 workspace。从 Finder 启动且继承的工作目录为 `/` 时，应用从用户的 Documents 目录开始；在应用内选择其他 workspace 后，会按常规方式切换活动 workspace。

## 配套 CLI

每个打包后的应用都包含版本匹配的 `dsh` companion：macOS 位于 `DeepSeek Harness.app/Contents/MacOS/dsh`，Windows 位于已安装应用旁的 `dsh.cmd`，Linux 位于压缩包中 `deepseek-harness` 旁的 `dsh`。该 companion 使用 Electron 内嵌的 Node 运行时启动随附 CLI，`dsh plugin` 则通过同一个可执行文件运行 CLI 锁定版本的 pnpm。私有的 `node` 与 `pnpm` shim 只对 companion 的进程树可见，其中也包括包生命周期脚本。因此，只安装桌面应用也能管理 profile 组合包，无需系统提供 Node.js 或 pnpm。

分发物不会修改用户的 `PATH`。请通过安装后的路径调用 companion，或在已加入 `PATH` 的目录中创建 shell 链接；macOS 默认安装位置的调用形式如下：

```sh
"/Applications/DeepSeek Harness.app/Contents/MacOS/dsh" plugin --profile web add package-name
```

Companion 与桌面应用共用 `$DSH_HOME` 和 `web` profile。添加、更新或移除组合包前先退出应用，操作完成后重新打开，使新的 profile 组合生效。包生命周期脚本以用户的宿主权限运行，且位于 agent 沙箱之外；只安装可信包，具体说明见[插件打包指南](../../docs/user/develop/basic/publish.md#installing-from-github-the-build-script-catch)。分发决策及未采用的自动修改 `PATH` 方案记录在 [companion CLI Agent Note](../../.agents/notes/implemented/feature/2026-08-14-desktop-companion-cli.md)中。

## Profile、设置与模型

桌面应用与 `dsh web` 共用 `web` profile 和 Harness home（`$DSH_HOME`，否则为 `~/.dsh`）。Profile 与 home 的 `cordis.patch.yml` 会在启动时参与组合，但由于 Electron 不公开配置 HMR 所用的 Node loader hook，其文件 watcher 被禁用；修改任一 patch 文件后需要重启应用。设置与凭据服务仍在组合中，因此通过「设置」进行的变更（包括模型提供方变更）仍会通过各自的实时服务生效。

DeepSeek 是随附默认值，并不是唯一支持的模型系列。可在「设置」中配置休眠挂载的 `llm-pi-ai` 适配器，启用 OpenAI、Anthropic、Google、OpenRouter、Mistral、Groq、xAI 等已安装 catalog 提供方，也可以完整声明 OpenAI-compatible／自托管路由。不同提供方的认证能力不同；权威 catalog 与协议限制见 [`dsh-llm-pi-ai`](../../packages/llm/llm-pi-ai/README.md)。

## 自动更新

官方 macOS 与 Windows Release 使用 `electron-updater` 和构建时固定的 GitHub Releases 元数据。更新器会拒绝预发布版本和降级，运行时无需 GitHub token，也不允许 renderer 选择 feed 或 Release URL。无证书 `0.1.1` Mac 应用带有稳定的 ad-hoc designated requirement `identifier "ai.deepseek.harness"`，但没有 Developer ID 身份认证或 notarization；Windows 应用与 NSIS 安装程序没有 Authenticode 签名，`app-update.yml` 也会省略 `publisherName`。因此，Gatekeeper 或 SmartScreen 仍可能向接收方发出警告，Windows 也不会为该 Release 检查发布者身份。显式 `signed` 模式则会为 Windows 固定证书的完整 Subject，并在打包前要求 Apple 与 Windows 凭据。macOS 更新仅在应用安装于 `/Applications` 或用户的 `Applications` 目录后运行。Linux 压缩包会公开 Releases 页面，但不支持原地更新。

「设置」提供四种持久策略：`background` 会在启动 30 秒后检查，并在此后每四小时检查一次；`startup` 会在同样的延迟后检查一次；`manual` 只响应显式操作；`disabled` 不执行检查。默认值是 `background`。主进程发布封闭的 `disabled`、`idle`、`checking`、`available`、`downloading`、`ready` 与 `error` 状态；后台检查得到「已是最新版本」或失败时保持安静，手动结果与可操作的 Release 则显示在 frame overlay 和「设置」中。

可用 Release 不会自动下载。用户需要主动开始下载，并在进入 `ready` 后另外选择**重启并安装**。Desktop 嵌入方会传入 `lifecycle: { kind: 'caller', attach, requestExit }`：`attach` 会在 profile boot 可能让出执行权前收到带时间上界的关停，`requestExit` 则把 profile 内的 `appExit` 交给 Electron。启动期间发起的关停会等待 profile Context 发布后再释放它，并阻止余下的更新器、IPC 与窗口 bootstrap 完成注册。安装流程会先停止更新器调度并中止应用工作；本地 cleanup 失败会被报告，但后续 cleanup 与 Harness 完全停稳仍会继续。错误报告属于 best-effort，因此报告本身失败也不能中断后续 cleanup、完全停稳或原生退出。只有 cleanup 和完全停稳都成功后，主进程才会调用平台安装器。调用后，主进程会在构建时固定的 2 分钟上限内等待原生 `before-quit-for-update` 确认。Cleanup 失败、资源释放失败或完全停稳超时会阻止安装器调用；安装交接错误或确认超时会使 Electron 以非零状态退出。普通退出使用同一个关停协调器，单实例锁则防止两个桌面进程竞争更新缓存。

首个启用该通道的 Release 是 seed 版本，必须手动安装；原地更新从下一个更高版本开始。回滚通过发布另一个更高的 patch 版本完成，不会启用降级。Mac 各架构使用独立更新通道，因此 x64 安装绝不会选择 arm64 产物。更新与发布不变量记录在[桌面自动更新 Agent Note](../../.agents/notes/implemented/feature/2026-08-14-desktop-automatic-updates.md)中；临时的平台真实性取舍由[无证书 Release 模式决策](../../.agents/notes/implemented/process/2026-08-15-certificate-free-desktop-release-mode.md)持有。

## 安全姿态

Renderer 以 `sandbox: true`、context isolation、禁用 Node integration、拒绝 Electron 权限请求的配置运行，且导航被限制在 `dsh://app`。Preload 只公开请求、取消、流、原生保存以及更新器状态／操作。每个 IPC 请求都会校验所属窗口、顶层 frame 和应用 origin；请求 URL 限于 `dsh://app`，body 有大小上限，文件名会收敛为 basename，更新操作则收敛为固定集合。更新器只接受经过校验的构建资源与精确的 HTTPS GitHub Releases URL；renderer 会在使用前校验每个返回状态。外部 HTTP(S) 链接交给操作系统处理。桌面载体只有通过这些校验后才被信任，且永不打开 Web 服务器。

内容安全策略允许 `unsafe-eval`，因为随附 Cordis 客户端需要求值配置表达式。其他 directive 与窗口导航策略仍会阻止远程脚本、嵌入 frame、object 和网络连接。

## 模型体验

除复用的 Web 组合外没有新增影响。桌面载体、原生对话框和应用 origin 不会添加任何模型可见的提示词、消息、工具或 schema 内容。

#### KV Cache 影响

无。桌面传输不会改变提供方请求或其稳定前缀。

## 已知限制与暂缓事项

- **本地打包仅面向本机**：一次调用只构建当前操作系统与架构。CI 会提供两个 Mac 架构以及 Windows x64 和 Linux x64，但不会生成 macOS universal 应用。
- **`0.1.1` Release 不使用证书**：macOS 使用不带身份认证或 notarization 的稳定 ad-hoc designated requirement，Windows 则省略 Authenticode 与 `publisherName`；操作系统信任警告仍可能出现。源码中的模式与审查标签设置会显式选择该 Release，signed 模式缺少任一必需凭据时仍会失败。
- **Linux 仍仅提供通知**：`.tar.gz` 没有能安全替换运行中应用的平台安装器，因此「设置」只会链接到 GitHub Releases 页面供手动安装。
- **Seed 版本无法凭空更新自身**：用户必须手动安装首个启用更新的版本；只有后续版本能走完整通道。
- **生产 workspace 保持非打包目录**：macOS 与 Linux 会保留跨越虚拟存储包目录的 pnpm 相对 workspace 链接；Windows 使用 hoisted 部署，避免 NSIS 在归档时展开链接依赖图。ASAR 仍处于禁用状态，因此生成的应用会明显大于完成 bundle 优化的发布产物。
- **Profile patch HMR 被禁用**：修改 profile 或 home 的 `cordis.patch.yml` 后需要重启应用；通过产品界面编辑的设置仍实时生效。
- **Unary IPC 响应会缓冲**：请求 body 延用 Connection 载体的 160 MiB 上限，非流式响应会在返回 renderer 前完整物化。只有两条长生命周期事件通道与原生 Session 日志保存使用流式传输。
