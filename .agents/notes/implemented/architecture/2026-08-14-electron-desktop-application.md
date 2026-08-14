# Agent Note: Electron desktop application with an in-process Host carrier

Status: implemented

English | [中文](2026-08-14-electron-desktop-application.zh.md)

## Problem

The browser application requires a local HTTP listener and leaves native desktop lifecycle, dialogs, packaging, and renderer isolation to the user's browser. A desktop product needs the existing graphical composition without duplicating its business UI or creating a second Host API implementation. It also needs a local trust model that does not treat privileged renderer requests as anonymous network traffic.

## Decision

`apps/desktop` is the Electron application. Its main process boots the existing `web` profile through `@deepseek-ai/dsh/profile-boot` and applies `config/desktop.patch.yml`: the Web server, browser startup/runtime, HMR client, and browser directory picker are disabled; the shared Connection and client-module registries remain mounted, and native directory-picker plus automatic-update rows replace or extend the browser composition. The desktop application adds no model-visible composition and uses the same settings, credentials, sessions, provider adapters, and client plugin graph as `dsh web`.

The main process serves the built frontend and client bundle graph from the privileged `dsh://app/` origin. It injects the boot manifest with the client-module registry's public graph helpers. A sandboxed, context-isolated renderer has no Node integration. Its preload exposes only structured-clone request, cancellation, stream, native-save, and automatic-update state/action operations.

`dsh-client-connection` owns the transport-neutral Host Fetch dispatcher. The Web composition projects it onto `/api` plus two WebSocket downlinks. `DesktopApiClient` instead serializes Fetch metadata and bytes across Electron IPC; unary responses return as one byte array, while `events.mux` and `events.host` stream the existing SSE representation as IPC chunks. The inherited API parser, rpcId rules, reconnect state machine, and generic RPC caller remain unchanged. The main process validates the owning `webContents`, top-level frame, `dsh://app` origin, URL authority, method, headers, body size, native-save filename, and closed updater action set before entering privileged code. Browser Host-header and origin fences remain on network routes and do not run again inside this validated local path.

Electron owns signals and window shutdown. Shared profile boot therefore exposes a process-owned or caller-owned lifecycle discriminant plus a profile-patch file-watching option. Desktop selects the caller lifecycle: `attach` supplies bounded shutdown before profile boot can yield, and `requestExit` routes in-profile `appExit` to Electron. Shutdown during startup waits for the profile Context to be published before disposing it, without changing process exit state. A single-instance lock keeps one Host and updater owner, while one shutdown coordinator handles windows, signals, `appExit`, and update installation. Local cleanup failures are reported while later cleanup and Host quiescence still proceed; cleanup failure, disposal failure, or timeout skips the installer and makes Electron exit nonzero. Settings services remain live, but profile and home patch files are read once per desktop launch because Electron does not expose the Node internal ESM loader needed by the config-HMR path. The app-boot Include resolves installed bare packages through `createRequire(bareModuleBaseUrl)` when that internal loader is absent.

The host-native packager deploys the desktop workspace with production dependencies and repairs the approved local subprocess helper. macOS and Linux retain pnpm's relative symlink graph in an unpacked application directory; Windows uses a hoisted deployment so NSIS archives physical dependencies without expanding that graph. The desktop manifest explicitly closes required workspace-peer dependencies because a portable pnpm deployment does not otherwise materialize every injected package's peer closure. Electron Builder emits a DMG and ZIP on macOS, an NSIS `.exe` installer on Windows, or a `.tar.gz` archive on Linux; updater metadata and blockmaps accompany the supported update formats. The GitHub Actions matrix runs both Mac architectures plus Windows x64 and Linux x64 on native runners. A `dsh-vX.Y.Z` tag must match a stable `X.Y.Z` desktop manifest and supplies release signing credentials: Mac applications are signed and notarized, and Windows applications and installers carry Authenticode signatures. After all native jobs pass, a dependent publisher validates the exact asset set and checksums, uploads it to a draft GitHub Release, and publishes only after every upload succeeds. A public tagged Release is immutable, and a rerun fails rather than accepting or replacing it. Manual runs retain only their expiring, ZIP-wrapped workflow artifacts and keep updates disabled. The [desktop automatic-updates decision](../feature/2026-08-14-desktop-automatic-updates.md) owns feed, policy, channel, and seed-release semantics.

## Security properties

The desktop origin is isolated from the network: navigation stays on `dsh://app`, Electron permission requests are denied, external HTTP(S) links leave the application through the operating system, and the content security policy blocks remote scripts, frames, objects, and connections. `unsafe-eval` remains enabled only because the shipped Cordis client evaluates configuration expressions. Native Session-log export streams from the Host response to a user-selected file in the main process; the renderer never receives the selected path or ZIP bytes. Updater feed identity comes from validated packaged resources, renderer messages cannot replace it, and release-page navigation accepts only the pinned HTTPS GitHub path.

## Verification

Connection, module-registry, loader-fallback, Session-log controller, shutdown-controller, and update-controller tests cover selection, serialization, streaming, cancellation, optional-Web-server, resolution, native-save, bounded caller-owned teardown, updater policy, and explicit install delegation. The keyless assembled Web replay continues to cover the reused UI composition. The package script checks the platform's required distribution and update-metadata files. `scripts/smoke-desktop.ts` starts the current platform's assembled application, waits for a fully composed `dsh://app/` renderer through a random loopback Chromium debugging endpoint, checks visible content and the updater bridge, and applies a bounded termination ladder for cleanup. Native workflow jobs repeat that build and smoke test for the four release targets; the tag-only publisher validates a stable tag, required counts, and feed references, uploads only the named asset set, and refuses a remote asset-name mismatch or existing public Release before publishing. Installing or uninstalling each container format, an end-to-end update between two public releases, and recipient-machine trust prompts remain named coverage gaps.

## Alternatives considered

**Wrap the existing localhost Web server.** This would minimize Host changes, but the desktop renderer would still depend on a listening port, inherit browser reachability policy, and keep native requests split across HTTP and Electron IPC.

**Load the frontend with `file://`.** A file origin has awkward origin and routing semantics for plugin bundle delivery and Fetch-compatible API URLs. A standard secure custom scheme gives the application one explicit origin and lets navigation, content security, and request validation use URL semantics consistently.

**Enable Node integration in the renderer.** Direct Node access would simplify file saves and Host calls, but it would turn every client bundle and rendered content path into process authority. The narrow preload bridge preserves the existing browser-side trust assumptions.

**Fork a desktop-specific UI.** A second React composition could specialize every interaction, but sessions, settings, models, tools, and plugin UI would drift from the Web product. Reusing the Web profile keeps platform differences in carriers and native capability providers.

**Bundle the deployed workspace into ASAR.** The pnpm deployment uses relative links across virtual-store package directories. ASAR rejects or breaks that graph, so the development artifact keeps a real directory until packaging introduces a different dependency layout.

**Cross-compile every artifact on one runner.** This would shorten the workflow, but the deployed application contains platform-native dependencies and needs to be started on its target operating system. Native jobs keep dependency selection, executable layout, and the smoke test aligned with the delivered artifact.

## Consequences

The repository produces zero-port desktop applications and shareable `.dmg`, `.zip`, `.exe`, and `.tar.gz` artifacts whose UI and Host semantics stay aligned with the browser product. Official tag builds establish signed Mac and Windows update channels without adding update behavior to the browser composition. Platform-specific code is confined to application assembly, IPC transport, native dialogs, updater ownership, and distribution metadata; the shared API, reconnect behavior, settings, and model-provider support remain single-owner.

The cost is a set of large unpacked applications, separate native CI jobs, long-lived signing credentials, no universal Mac build, and no in-place updater for the Linux archive. Unary IPC transfers use memory in both processes, portable packaging requires an explicit workspace peer closure, patch-file HMR remains unavailable, and release publication must wait for every platform plus the exact-asset validation step.
