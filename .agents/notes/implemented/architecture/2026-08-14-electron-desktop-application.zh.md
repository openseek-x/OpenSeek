# Agent Note: 采用进程内 Host 载体的 Electron 桌面应用

Status: implemented

[English](2026-08-14-electron-desktop-application.md) | 中文

## Problem

浏览器应用需要本机 HTTP listener，并把原生桌面生命周期、对话框、打包和 renderer 隔离交给用户浏览器。桌面产品需要复用现有图形组合，且不能复制业务 UI 或产生第二份 Host API 实现。它还需要一套本地信任模型，不能把受信 renderer 的特权请求当作匿名网络流量处理。

## Decision

`apps/desktop` 是 Electron 应用。其主进程通过 `@deepseek-ai/dsh/profile-boot` 启动现有 `web` profile，并应用 `config/desktop.patch.yml`：禁用 Web 服务器、浏览器 startup/runtime、HMR client 和浏览器目录选择器；保留共享 Connection 与客户端模块注册表，再用原生目录选择器与自动更新条目替换或扩展浏览器组合。桌面应用不新增模型可见组合，并与 `dsh web` 使用相同的设置、凭据、Session、提供方适配器和客户端插件图。

主进程从特权 `dsh://app/` origin 提供已构建前端和客户端 bundle 图，并通过客户端模块注册表的公开图 helper 注入启动 manifest。沙箱化且 context-isolated 的 renderer 不启用 Node integration。其 preload 只公开 structured-clone 请求、取消、流、原生保存以及自动更新状态／操作。Preload 自身会识别页面非交互区域的主指针按下，并通过封闭的拖动 IPC 发送匹配的指针屏幕坐标；页面 JavaScript 不会获得窗口移动 API。主进程只有在校验 sender、origin 与有限且位于上限内的坐标后，才会移动所属且可移动的窗口；释放、取消、失焦、窗口关闭和关停都会清除手势状态。

`dsh-client-connection` 持有不依赖传输的 Host Fetch 分发器。Web 组合把它投射为 `/api` 与两条 WebSocket 下行。`DesktopApiClient` 则把 Fetch 元数据和字节序列化到 Electron IPC；unary 响应以一个字节数组返回，`events.mux` 与 `events.host` 把现有 SSE 表示流式传为 IPC 分块。继承的 API parser、rpcId 规则、重连状态机和通用 RPC caller 不变。主进程会先校验所属 `webContents`、顶层 frame、`dsh://app` origin、URL authority、method、header、body 大小、原生保存文件名以及封闭的更新操作集合，再进入特权代码。浏览器 Host-header 与 origin fence 仍位于网络 route，不会在已校验的本地路径内重复执行。

Electron 持有 signal 与窗口关闭生命周期。因此，共享 profile boot 会公开进程持有或调用方持有的生命周期判别项，以及 profile patch 文件监视选项。Desktop 会选择调用方生命周期：`attach` 会在 profile boot 可能让出执行权前提供带时间上界的关停，`requestExit` 则把 profile 内的 `appExit` 交给 Electron。启动期间发起的关停会等待 profile Context 发布后再释放它，并且不会改变进程退出状态。单实例锁保证只有一份 Host 与更新器 owner；同一个关停协调器处理窗口、signal、`appExit` 与更新安装。本地 cleanup 失败会被报告，但后续 cleanup 与 Host 完全停稳仍会继续；cleanup 失败、资源释放失败或超时都会跳过安装器，并使 Electron 以非零状态退出。设置服务仍然实时生效，但由于 Electron 不公开配置 HMR 路径所需的 Node 内部 ESM loader，profile 与 home patch 文件在每次桌面启动时只读取一次。当该内部 loader 缺失时，app-boot Include 通过 `createRequire(bareModuleBaseUrl)` 解析已安装裸包。

宿主原生打包器会部署带生产依赖的桌面 workspace，并修复已批准的本地 subprocess helper。macOS 与 Linux 会在非打包应用目录中保留 pnpm 相对符号链接图；Windows 使用 hoisted 部署，使 NSIS 能够归档实体依赖而不展开该链接图。桌面 manifest 会显式闭合必需的 workspace peer dependency，因为可移植 pnpm deployment 不会自动物化每个 injected 包的完整 peer 闭包。Electron Builder 在 macOS 上生成 DMG 与 ZIP，在 Windows 上生成 NSIS `.exe` 安装程序，在 Linux 上生成 `.tar.gz` 压缩包；受支持的更新格式还会附带更新元数据与 blockmap。GitHub Actions 矩阵会在原生 runner 上构建两个 Mac 架构以及 Windows x64 和 Linux x64。`dsh-vX.Y.Z` 标签必须与稳定的 `X.Y.Z` 桌面 manifest 一致，并选择版本控制中的显式签名模式。无证书模式与经过审查的 `dsh-v0.1.1` 标签设置会给 Mac 应用提供稳定的 ad-hoc designated requirement，但不执行 notarization；Windows 应用与安装程序保持未签名并省略 `publisherName`；保留的 signed 模式则要求 Apple 与 Windows 凭据。所有原生 job 通过后，依赖它们的发布 job 会校验精确的产物集合与 checksum，将其上传到草稿 GitHub Release，并且只在所有上传成功后发布。公开的带标签 Release 不可变，重新运行会失败，而不是接受或替换它。手动运行使用无证书打包，只保留外层带 ZIP 且会过期的工作流产物，绝不会发布。[桌面自动更新决策](../feature/2026-08-14-desktop-automatic-updates.md)持有 feed、策略、通道与 seed Release 语义；[无证书 Release 模式决策](../process/2026-08-15-certificate-free-desktop-release-mode.md)持有临时的平台身份取舍。

## Security properties

桌面 origin 与网络隔离：导航保持在 `dsh://app`，Electron 会允许所属顶层应用 frame 的全部非空权限，并拒绝其他窗口、subframe 或 origin 的请求，外部 HTTP(S) 链接通过操作系统离开应用，内容安全策略会阻止远程脚本、frame、object 与连接。操作系统隐私授权仍由操作系统决定是否询问。仅因随附 Cordis 客户端需要求值配置表达式而保留 `unsafe-eval`。原生 Session 日志导出会在主进程中把 Host 响应流式写入用户选定文件；renderer 永远拿不到选定路径或 ZIP 字节。按住拖动窗口手势停留在 preload 内，其主进程路由只接受经过校验的顶层 `dsh://app` sender 以及有限且位于上限内的坐标。更新器 feed 身份来自经过校验的打包资源，renderer 消息无法替换它，Release 页面导航也只接受固定的 HTTPS GitHub 路径。

## Verification

Connection、模块注册表、loader fallback、Session 日志控制器、关停控制器、更新控制器、聚焦的拖动手势测试和桌面权限测试覆盖选择、序列化、流、取消、可选 Web 服务器、解析、原生保存、经过校验的拖动坐标、指针 owner、所属 frame 的权限、有界且由调用方持有的 teardown、更新策略和显式安装委托。无密钥的组装 Web replay 继续覆盖被复用的 UI 组合。打包脚本会检查对应平台必需的分发文件与更新元数据。`scripts/smoke-desktop.ts` 会启动当前平台组装后的应用，通过随机 loopback Chromium 调试 endpoint 等待完全组合的 `dsh://app` renderer，检查可见内容与更新桥，并使用有界终止阶梯完成清理。原生工作流 job 会针对四个发布目标重复该构建与冒烟测试；仅标签运行的发布 job 会校验稳定标签、必需数量与 feed 引用，只上传具名产物集合，并在发布前拒绝远端产物名称不匹配或已有的公开 Release。各容器格式的安装与卸载、两个公开 Release 之间的端到端更新，以及接收机器的信任提示仍是具名覆盖缺口。

## Alternatives considered

**包装现有 localhost Web 服务器。** 这能减少 Host 改动，但桌面 renderer 仍依赖 listener，继续继承浏览器可达性策略，而且原生请求会被拆分在 HTTP 与 Electron IPC 两条路径。

**通过 `file://` 加载前端。** File origin 在插件 bundle 交付和 Fetch-compatible API URL 上具有别扭的 origin 与路由语义。标准、安全的自定义 scheme 为应用提供一个显式 origin，使导航、内容安全和请求校验能够一致地使用 URL 语义。

**在 renderer 中启用 Node integration。** 直接 Node 访问会简化文件保存与 Host 调用，但也会让每个客户端 bundle 与渲染内容路径都获得进程权限。窄 preload 桥保留了现有浏览器侧信任假设。

**Fork 一套桌面专用 UI。** 第二份 React 组合可以专门化每项交互，但 Session、设置、模型、工具与插件 UI 会逐渐偏离 Web 产品。复用 Web profile 会把平台差异限制在载体和原生能力提供方。

**把部署后的 workspace 打入 ASAR。** Pnpm deployment 使用跨虚拟存储包目录的相对链接。ASAR 会拒绝或破坏这张图，因此在打包流程采用其他依赖布局前，开发工件保持真实目录。

**在一个 runner 上交叉编译全部产物。** 这可以缩短工作流，但部署后的应用包含平台原生依赖，且需要在目标操作系统上实际启动。原生 job 能让依赖选择、可执行文件布局与冒烟测试和交付产物保持一致。

## Consequences

仓库能够生成零端口桌面应用及可分享的 `.dmg`、`.zip`、`.exe` 和 `.tar.gz` 产物，其 UI 与 Host 语义和浏览器产品保持一致。正式标签构建会建立经过校验的 Mac 与 Windows 更新通道，而不会给浏览器组合加入更新行为；是否具有证书支持的发布者身份取决于显式选择的 Release 模式。平台专用代码被限制在应用组装、IPC 传输、原生对话框、更新器 owner 与分发元数据；共享 API、重连行为、设置与模型提供方支持仍各有单一 owner。

代价是一组体积较大的非打包目录应用、彼此独立的原生 CI job、缺失的 Mac universal 构建，以及 Linux 压缩包没有原地更新器。无证书 Release 可能触发 Gatekeeper 或 SmartScreen 警告；signed Release 还需要长期管理的签名凭据。Unary IPC 传输会在两个进程中占用内存，可移植打包仍需要显式 workspace peer 闭包，patch 文件 HMR 仍不可用，Release 发布还必须等待全部平台与精确产物校验步骤。
