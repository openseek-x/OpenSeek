# @deepseek-ai/dsh-client-connection

English | [中文](README.zh.md)

Connection consumer and carrier layer. The client plugin mounts `ctx.connection`: one shared API client, current-page loopback state, generation-scoped observable `hostDescription`, generic RPC, and the single-consumer stream-loop starter. A successful readiness handshake publishes the exact `host.describe` value before `onConnected`; generation loss and explicit stop clear it. Apply selects a fixture, browser, or Electron carrier without exposing the platform classes to other plugins.

The browser carrier uses HTTP POST for unary and respond operations and opens one downlink-only WebSocket each for `events.mux` and `events.host`. The Electron carrier sends unary requests and both event streams through the context-isolated preload bridge as structured-clone metadata and bytes. The Host half owns one Fetch dispatch table independently of the optional Web server: generic channel interceptors take precedence over the API Proxy fallback, and the Web composition additionally exposes that table under `/api`.

The Web `/api` route pins privileged methods to loopback: `host.pickDirectory`, `host.openPath`, the settings and credentials planes, `llm.discoverModels`, and the agent-preset authoring plane. These include reads because they disclose configuration or credential provenance, and native actions because they operate the Host desktop. `agentPreset.list` and `agentPreset.select` stay outside the set: the roster carries only ids and trust, and `session.create` already accepts the same preset selection. A declared `trustedHosts` authority reaches other methods, while the privileged set remains loopback-local until an authentication layer exists. The [WebSocket downlink](../../../.agents/notes/implemented/architecture/2026-08-04-websocket-downlink-carrier.md) and [Electron desktop](../../../.agents/notes/implemented/architecture/2026-08-14-electron-desktop-application.md) Agent Notes own the physical-carrier decisions.

## `/api` browser-trust fence

The node half guards every entry under `/api` before bridging or upgrading (`src/api-request-trust.ts`). Every request must present a `Host` that is a loopback authority or matches a `trustedHosts` entry: `host:port` entries match exactly, port-less entries match any port, and both sides use WHATWG normalization. There is no shortcut for requests without browser markers: over plain HTTP a browser attaches neither `Origin` nor Fetch Metadata to image and navigation reads, so an unmarked request may still be a readable DNS-rebinding request, while Host is the header rebinding cannot forge. A browser WebSocket handshake carries `Origin` and passes the same comparison.

When markers are present, `Origin` must equal the Host authority and an explicit `sec-fetch-site: cross-site` marker is refused. A `trustedHosts` entry that is not a bare canonical `host[:port]` authority fails plugin load. HTTP failures answer plain 403 before RPC dispatch; upgrade failures reject before an event stream starts. Non-loopback compositions must trust their serving authorities explicitly. `dsh web --host 0.0.0.0` remains unsupported until remote access has authentication. This fence is reachability policy, not authentication; see the [API browser-trust decision](../../../.agents/notes/implemented/architecture/2026-07-28-api-browser-trust-boundary.md).

## `/api` WebSocket downlinks

`/api/events.mux` and `/api/events.host` each accept a WebSocket upgrade and send only the corresponding `ServerRequest` text messages to the browser. If either socket ends, the current connection generation fails and rebuilds both streams; readiness requires both sockets plus a successful `host.describe` HTTP call. Host teardown terminates both sockets, aborts their sources, and waits for source cleanup. Ordinary network GETs to these paths return 426 with no SSE fallback; `toFetchHandler`'s SSE codec serves the in-process and desktop Fetch carriers.

## Desktop IPC carrier

When a validated `globalThis.dshDesktop` preload bridge is present, apply constructs `DesktopApiClient` and routes generic RPC through the same `ConnectionFetch`. Request ids, methods, headers, and optional bytes cross as structured-clone values; unary replies are reconstructed as standard `Response` objects. Both event paths keep the API Proxy's SSE framing inside a streamed IPC response, so the inherited parser and connection-generation behavior remain unchanged. Abort signals cancel the matching main-process request or stream. Trust for this path belongs to the Electron shell's sender, top-frame, and origin validation; the trusted in-process dispatcher deliberately does not apply the browser Host-header fence.

## Desktop update bridge

This package also owns the shared structured-clone protocol for the separate `globalThis.dshDesktopUpdate` preload bridge. `DesktopUpdatePolicy` closes policy to `background`, `startup`, `manual`, or `disabled`; `DesktopUpdateAction` closes renderer requests to `check`, `download`, `install`, or `open-release`; and revisioned `DesktopUpdateState` values distinguish `disabled`, `idle`, `checking`, `available`, `downloading`, `ready`, and `error`. The bridge supports state reads, state observation, and validated action invocation.

`isDesktopUpdateAction` protects the main-process IPC entry, while `parseDesktopUpdateState` checks every main-to-renderer value, including status-specific fields, safe-integer revisions, bounded progress, timestamps, and the exact HTTPS GitHub Releases URL form. The Electron shell implements the bridge and owns the updater lifecycle; [`dsh-client-ui-desktop-update`](../ui-desktop-update/README.md) owns the durable setting and renderer presentation. This package starts no release check and opens no installer. The [automatic-update Agent Note](../../../.agents/notes/implemented/feature/2026-08-14-desktop-automatic-updates.md) records the cross-process trust and release decisions.

## Model Experience

None, as this layer moves already-composed messages between client and Host; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **History resumes an unattached session** — opening history may create the Host-side agent and add latency to the first open; there is no persistence-only read path.
- **The Web `/api` bridge buffers each request body in memory** — `maxRequestBodyBytes` defaults to 160 MiB, sized for the default 100 MiB aggregate image limit after base64 expansion plus envelope headroom.
- **Desktop unary transfers are buffered** — request bodies and non-streaming responses materialize as structured-clone bytes; only the two event streams remain incremental.
