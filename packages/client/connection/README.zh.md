# @deepseek-ai/dsh-client-connection

[English](README.md) | 中文

Connection 消费与载体层。客户端插件挂载 `ctx.connection`：一个共享 API 客户端、当前页面的 loopback 状态、按 generation 生效的可观察 `hostDescription`、通用 RPC，以及单消费方流循环启动器。就绪握手成功后会在 `onConnected` 前发布完整的 `host.describe` 值；generation 失效或显式 stop 会清空它。Apply 会选择 fixture、浏览器或 Electron 载体，而不会把平台类暴露给其他插件。

浏览器载体以 HTTP POST 发送 unary／respond，并为 `events.mux` 与 `events.host` 各开一条只下行的 WebSocket。Electron 载体则把 unary 请求与两条事件流作为 structured-clone 元数据和字节，经 context-isolated preload 桥传输。Host half 持有不依赖可选 Web 服务器的 Fetch 分发表：通用 channel interceptor 优先于 API Proxy fallback；Web 组合还会把这张表暴露在 `/api` 下。

Web `/api` route 会把特权方法固定在 loopback：`host.pickDirectory`、`host.openPath`、设置与凭据平面、`llm.discoverModels`，以及 agent preset 创作平面。读取也在其中，因为它们会公开配置或凭据来源；原生操作也在其中，因为它们会操作 Host 桌面。`agentPreset.list` 与 `agentPreset.select` 留在集合之外：roster 只携带 id 与信任级别，而 `session.create` 已接受同一项 preset 选择。已声明的 `trustedHosts` authority 可到达其他方法；在认证层出现前，特权集合仍只限 loopback。本地物理载体决策由 [WebSocket 下行](../../../.agents/notes/implemented/architecture/2026-08-04-websocket-downlink-carrier.md)与 [Electron 桌面应用](../../../.agents/notes/implemented/architecture/2026-08-14-electron-desktop-application.md) Agent Note 负责。

## `/api` 浏览器信任栅栏

Node half 会在桥接或 upgrade 前守卫 `/api` 下的每个入口（`src/api-request-trust.ts`）。每个请求的 `Host` 都必须是 loopback authority 或与一个 `trustedHosts` 条目匹配：`host:port` 条目精确匹配，不带端口的条目匹配任意端口，两侧均采用 WHATWG 归一化。没有针对缺少浏览器标记之请求的捷径：在明文 HTTP 下，浏览器的图片与导航读取既不带 `Origin`，也不带 Fetch Metadata，因此无标记请求仍可能是响应可读的 DNS rebinding 请求；Host 则是 rebinding 无法伪造的 header。浏览器 WebSocket 握手会携带 `Origin`，并通过同一道比较。

存在浏览器标记时，`Origin` 必须与 Host authority 相等，显式的 `sec-fetch-site: cross-site` 标记会被拒绝。不是纯规范形 `host[:port]` authority 的 `trustedHosts` 条目会让插件加载失败。HTTP 失败会在 RPC 分发前返回纯 403；upgrade 失败会在事件流开始前拒绝。非 loopback 组合必须显式信任其服务 authority。`dsh web --host 0.0.0.0` 在远程访问具备认证之前仍不受支持。该栅栏是可达性策略，不是认证；详见 [API 浏览器信任决策](../../../.agents/notes/implemented/architecture/2026-07-28-api-browser-trust-boundary.md)。

## `/api` WebSocket 下行

`/api/events.mux` 与 `/api/events.host` 各接受一条 WebSocket upgrade，并只向浏览器发送对应的 `ServerRequest` 文本消息。任一 socket 结束都会让当前 connection generation 失败并重建两条流；就绪要求两条 socket 均已打开，且 `host.describe` HTTP 调用成功。Host teardown 会终止两条 socket、中止各自的 source，并等待 source 清理。普通网络 GET 这些路径会返回 426，不提供 SSE fallback；`toFetchHandler` 的 SSE codec 服务进程内与桌面 Fetch 载体。

## 桌面 IPC 载体

当存在经过校验的 `globalThis.dshDesktop` preload 桥时，apply 会构造 `DesktopApiClient`，并让通用 RPC 走同一个 `ConnectionFetch`。请求 id、method、header 和可选字节以 structured-clone 值穿过桥；unary 回复会重建为标准 `Response`。两条事件路径在流式 IPC 响应中保留 API Proxy 的 SSE framing，因此继承的解析器与 connection generation 行为无需改变。Abort signal 会取消主进程中对应的请求或流。该路径的信任来自 Electron 壳对 sender、顶层 frame 与 origin 的校验；受信进程内分发器有意不应用浏览器 Host-header fence。

## 桌面更新桥

本包还持有独立 `globalThis.dshDesktopUpdate` preload 桥的共享 structured-clone 协议。`DesktopUpdatePolicy` 把策略封闭为 `background`、`startup`、`manual` 或 `disabled`；`DesktopUpdateAction` 把 renderer 请求封闭为 `check`、`download`、`install` 或 `open-release`；带修订号的 `DesktopUpdateState` 值则区分 `disabled`、`idle`、`checking`、`available`、`downloading`、`ready` 与 `error`。该桥支持状态读取、状态观察与经过校验的操作调用。

`isDesktopUpdateAction` 保护主进程 IPC 入口，`parseDesktopUpdateState` 则检查每个主进程到 renderer 的值，包括各状态专用字段、安全整数修订号、有界进度、时间戳与精确的 HTTPS GitHub Releases URL 形式。Electron 壳实现该桥并持有更新器生命周期；[`dsh-client-ui-desktop-update`](../ui-desktop-update/README.md)持有持久设置与 renderer 展示。本包不会开始 Release 检查，也不会打开安装器。[自动更新 Agent Note](../../../.agents/notes/implemented/feature/2026-08-14-desktop-automatic-updates.md)记录了跨进程信任与发布决策。

## 模型体验

无。该层只在客户端与 Host 之间搬运已经组合好的消息；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **History 会恢复未附加的 Session**：打开 history 可能创建 Host 侧 agent，并增加首次打开的延迟；没有仅从持久化读取的路径。
- **Web `/api` 桥会把每个请求体整体缓冲在内存中**：`maxRequestBodyBytes` 默认为 160 MiB；该值按默认 100 MiB 聚合图片上限经 base64 膨胀后再加 envelope 余量确定。
- **桌面 unary 传输会缓冲**：请求 body 与非流式响应会物化为 structured-clone 字节；只有两条事件流保持增量传输。
