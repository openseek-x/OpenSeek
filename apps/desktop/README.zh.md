# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

DeepSeek Harness 图形客户端的 Electron 应用。主进程在进程内启动随附的 `web` profile，应用 `config/desktop.patch.yml` 以替换 HTTP 服务器和仅浏览器使用的条目，再打开与 `dsh web` 相同的已构建客户端组合。因此，renderer（渲染器）无需本机端口即可保留 Web 产品的 Session、设置、模型选择、工具和插件 UI。

构建后的前端与客户端插件 bundle 由安全的 `dsh://app/` 应用 origin 提供。Unary API 与通用 RPC 请求以 structured-clone 元数据和字节穿过 context-isolated preload 桥；两条事件通道通过同一桥流式传输分块。主进程把这些 Fetch 形式的请求分发给 `HostConnectionService`，因此 Host API 仍只有一份实现。目录选择与 Session 日志导出使用原生对话框。

## 运行与打包

在仓库根目录执行：

```sh
pnpm run desktop
pnpm run package:desktop
pnpm run test:desktop:packaged
```

`desktop` 会构建仓库并从源码启动 Electron。`package:desktop` 面向当前宿主与架构构建，在 macOS 与 Windows 上于 `dist-desktop/DeepSeek Harness-<platform>-<arch>/` 下组装独立应用，在 Linux 上则使用 `dist-desktop/DeepSeek-Harness-linux-<arch>/`，并生成一个分发产物：

- macOS：`dist-desktop/installers/DeepSeek-Harness-<version>-mac-<arch>.dmg`
- Windows：`dist-desktop/installers/DeepSeek-Harness-<version>-win-<arch>.exe`
- Linux：`dist-desktop/installers/DeepSeek-Harness-<version>-linux-<arch>.tar.gz`

`test:desktop:packaged` 会启动组装后的应用，通过随机的本机 Chromium 调试端口等待完整界面组合完成，并检查可见内容。[Desktop packages](../../.github/workflows/desktop-packages.yml) 会针对 macOS arm64 与 x64、Windows x64 和 Linux x64 执行原生构建与冒烟测试，再把各安装程序或压缩包上传为工作流产物。

从终端启动时，终端当前目录是初始 workspace。从 Finder 启动且继承的工作目录为 `/` 时，应用从用户的 Documents 目录开始；在应用内选择其他 workspace 后，会按常规方式切换活动 workspace。

## Profile、设置与模型

桌面应用与 `dsh web` 共用 `web` profile 和 Harness home（`$DSH_HOME`，否则为 `~/.dsh`）。Profile 与 home 的 `cordis.patch.yml` 会在启动时参与组合，但由于 Electron 不公开配置 HMR 所用的 Node loader hook，其文件 watcher 被禁用；修改任一 patch 文件后需要重启应用。设置与凭据服务仍在组合中，因此通过「设置」进行的变更（包括模型提供方变更）仍会通过各自的实时服务生效。

DeepSeek 是随附默认值，并不是唯一支持的模型系列。可在「设置」中配置休眠挂载的 `llm-pi-ai` 适配器，启用 OpenAI、Anthropic、Google、OpenRouter、Mistral、Groq、xAI 等已安装 catalog 提供方，也可以完整声明 OpenAI-compatible／自托管路由。不同提供方的认证能力不同；权威 catalog 与协议限制见 [`dsh-llm-pi-ai`](../../packages/llm/llm-pi-ai/README.md)。

## 安全姿态

Renderer 以 `sandbox: true`、context isolation、禁用 Node integration、拒绝 Electron 权限请求的配置运行，且导航被限制在 `dsh://app`。Preload 只公开请求、取消、流和原生保存操作。每个 IPC 请求都会校验所属窗口、顶层 frame 和应用 origin；请求 URL 限于 `dsh://app`，body 有大小上限，文件名会收敛为 basename。外部 HTTP(S) 链接交给操作系统处理。桌面载体只有通过这些校验后才被信任，且永不打开 Web 服务器。

内容安全策略允许 `unsafe-eval`，因为随附 Cordis 客户端需要求值配置表达式。其他 directive 与窗口导航策略仍会阻止远程脚本、嵌入 frame、object 和网络连接。

## 模型体验

除复用的 Web 组合外没有新增影响。桌面载体、原生对话框和应用 origin 不会添加任何模型可见的提示词、消息、工具或 schema 内容。

#### KV Cache 影响

无。桌面传输不会改变提供方请求或其稳定前缀。

## 已知限制与暂缓事项

- **本地打包仅面向本机**：一次调用只构建当前操作系统与架构。CI 会提供两个 Mac 架构以及 Windows x64 和 Linux x64，但不会生成 macOS universal 应用。
- **分发不使用发布证书**：macOS 应用只有 ad-hoc 签名且未 notarize；Windows 安装程序没有 Authenticode 签名。产物已包含品牌图标，但在增加已签名发布通道前，接收者仍可能看到 Gatekeeper 或 SmartScreen 警告。
- **生产 workspace 保持非打包目录**：pnpm 的相对 workspace 链接会跨越虚拟存储中的包目录，因此禁用 ASAR。生成的应用会明显大于完成 bundle 优化的发布工件。
- **Profile patch HMR 被禁用**：修改 profile 或 home 的 `cordis.patch.yml` 后需要重启应用；通过产品界面编辑的设置仍实时生效。
- **Unary IPC 响应会缓冲**：请求 body 延用 Connection 载体的 160 MiB 上限，非流式响应会在返回 renderer 前完整物化。只有两条长生命周期事件通道与原生 Session 日志保存使用流式传输。
