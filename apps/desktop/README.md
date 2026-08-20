# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

Electron application for the DeepSeek Harness graphical client. The main process boots the shipped `web` profile in-process, applies `config/desktop.patch.yml` to replace the HTTP server and browser-only rows, and opens the same built client composition used by `dsh web`. The renderer therefore keeps the Web product's sessions, settings, model selection, tools, and plugin UI without requiring a localhost port.

The built frontend and client plugin bundles are served from the secure `dsh://app/` application origin. Unary API and generic RPC requests cross a context-isolated preload bridge as structured-clone metadata and bytes; the two event channels stream chunks over the same bridge. The main process dispatches those Fetch-shaped requests through `HostConnectionService`, so the Host API remains the single implementation. Directory selection and Session-log export use native dialogs. A Desktop-only plugin adds update preferences and a non-modal update notice without changing the browser composition.

## Move the window

Press and drag from a non-interactive page area to move the native window. Buttons, links, form controls, selectable editors, and draggable product controls do not start a window drag. Releasing the pointer, cancelling it, or moving focus away ends the gesture.

## Run and package

From the repository root:

```sh
pnpm run desktop
pnpm run package:desktop
pnpm run test:desktop:packaged
```

`desktop` builds the repository and starts Electron from source. `package:desktop` builds the current host and architecture, assembles a self-contained application under `dist-desktop/DeepSeek Harness-<platform>-<arch>/` on macOS and Windows or `dist-desktop/DeepSeek-Harness-linux-<arch>/` on Linux, and emits the platform distribution files:

- macOS: `dist-desktop/installers/DeepSeek-Harness-<version>-mac-<arch>.dmg` and `.zip`
- Windows: `dist-desktop/installers/DeepSeek-Harness-<version>-win-<arch>.exe` and its `.blockmap`
- Linux: `dist-desktop/installers/DeepSeek-Harness-<version>-linux-<arch>.tar.gz`

Mac packaging also emits `latest-arm64-mac.yml` or `latest-x64-mac.yml` beside the matching architecture, and Windows x64 packaging emits `latest.yml`. These documents are harmless in an updater-disabled local package; Linux emits no channel document.

`test:desktop:packaged` starts the assembled application, waits for the composed interface through a random loopback Chromium debugging port, and checks its visible content, updater bridge, and coordinated shutdown. After the interface checks, it uses the loopback-only main-process inspector opened by `--inspect=0` to evaluate `process.emit('SIGTERM')`, directly exercising the registered signal shutdown path. The child process must emit `close` within five seconds with `exitCode === 0` and `signalCode === null`, and captured output must contain `dsh desktop: shutdown quiesced`, which the main process emits only after cleanup and Host quiescence succeed. A timeout uses `SIGKILL` only to clean up the process and still fails the test. [Desktop packages](../../.github/workflows/desktop-packages.yml) runs the native build and smoke test for macOS arm64 and x64, Windows x64, and Linux x64, then uploads each installer or archive as a workflow artifact. A release tag has the form `dsh-vX.Y.Z` and must exactly match a stable `X.Y.Z` desktop manifest version; prerelease versions are rejected. The workflow declares one closed release-signing mode in source control. The mode is currently `certificate-free`, while a separate reviewed-tag setting limits publication to `dsh-v0.1.3`; any other tag fails until the mode or reviewed tag is explicitly changed. Before upload, each Mac or Windows job parses its updater document and verifies the exact artifact paths, sizes, SHA-512 digests, and selected signature state. The release job then validates the complete cross-platform asset set and checksums, uploads it to a draft GitHub Release, and publishes that draft only after every upload succeeds. A published tag is immutable: rerunning its workflow fails instead of accepting or replacing the existing public Release. Manual runs use certificate-free packaging, retain their ZIP-wrapped workflow artifacts for 14 days, and do not publish a release.

Every final publication job binds to `desktop-release`. For the certificate-free `0.1.3` release, that Environment supplies no signing secret and imposes no manual approval; certificate-free, manual, and Linux package jobs use the separate secret-free `desktop-package` Environment. Before selecting `signed`, configure `desktop-release` with required reviewers, disabled self-review and protection-rule bypass, a selected `dsh-v*` Tag deployment rule, and the signing secrets; protect `refs/tags/dsh-v*` against unauthorized creation, updates, and deletion. Signed-mode Mac and Windows jobs then bind to `desktop-release` as well.

`MACOS_CERTIFICATE_BASE64`, `MACOS_CERTIFICATE_PASSWORD`, `MACOS_SIGN_IDENTITY`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WINDOWS_CERTIFICATE_BASE64`, and `WINDOWS_CERTIFICATE_PASSWORD` are read only when the workflow's release-signing mode is `signed` and must then exist only as `desktop-release` Environment secrets, with no repository- or organization-level copies under the same names. Missing credentials fail signed mode instead of selecting certificate-free packaging.

A terminal launch keeps the terminal's current directory as the initial workspace. A Finder launch whose inherited working directory is `/` starts in the user's Documents directory; selecting another workspace in the application changes the active workspace in the normal way.

## Companion CLI

Every packaged application contains a version-matched `dsh` companion: `DeepSeek Harness.app/Contents/MacOS/dsh` on macOS, `dsh.cmd` beside the installed application on Windows, and `dsh` beside `deepseek-harness` in the Linux archive. The companion runs the shipped CLI with Electron's embedded Node runtime, and `dsh plugin` runs the CLI's pinned pnpm through that same executable. Private `node` and `pnpm` shims are visible only to the companion process tree, including package lifecycle scripts. A desktop-only installation therefore needs neither system Node.js nor pnpm to manage profile bundles.

The distribution does not modify the user's `PATH`. Invoke the companion by its installed path or create a shell link in a directory already on `PATH`; the macOS default-location form is:

```sh
"/Applications/DeepSeek Harness.app/Contents/MacOS/dsh" plugin --profile web add package-name
```

The companion and desktop application share `$DSH_HOME` and the `web` profile. Quit the application before adding, updating, or removing a bundle, then reopen it so the new profile composition takes effect. Package lifecycle scripts run with the user's host authority, outside the agent sandbox; only install trusted packages, as described in the [plugin packaging guide](../../docs/user/develop/basic/publish.md#installing-from-github-the-build-script-catch). The distribution decision and rejected automatic-`PATH` alternatives are recorded in the [companion CLI Agent Note](../../.agents/notes/implemented/feature/2026-08-14-desktop-companion-cli.md).

## Profiles, settings, and models

The desktop application shares the `web` profile and Harness home (`$DSH_HOME`, otherwise `~/.dsh`) with `dsh web`. Profile and home `cordis.patch.yml` files are composed at startup, but their file watchers are disabled because Electron does not expose the Node loader hook used by config HMR; restart the application after changing either patch file. The settings and credentials services remain part of the composition, so changes made through Settings, including model-provider changes, continue to apply through their own live services.

DeepSeek is the shipped default, not the only supported model family. The dormant `llm-pi-ai` adapter can be configured from Settings for installed catalog providers such as OpenAI, Anthropic, Google, OpenRouter, Mistral, Groq, and xAI, or for a fully declared OpenAI-compatible/self-hosted route. Authentication support varies by provider; see [`dsh-llm-pi-ai`](../../packages/llm/llm-pi-ai/README.md) for the authoritative catalog and protocol constraints.

## Automatic updates

Official macOS and Windows releases use `electron-updater` with build-pinned GitHub Releases metadata. The updater rejects prereleases and downgrades, never requires a GitHub token at runtime, and does not let the renderer choose a feed or release URL. The certificate-free `0.1.1` seed, `0.1.2` successor, and `0.1.3` Mac applications carry a stable ad-hoc designated requirement, `identifier "ai.deepseek.harness"`, but no Developer ID identity or notarization; the Windows applications and NSIS installers carry no Authenticode signature, and `app-update.yml` omits `publisherName`. Gatekeeper or SmartScreen can therefore warn recipients, and Windows performs no publisher-identity check for these releases. Explicit `signed` mode instead pins the certificate's full Subject for Windows and requires the Apple and Windows credentials before packaging. macOS updates run only after the application is installed under `/Applications` or the user's `Applications` directory. Linux archives expose the Releases page but do not support in-place updates.

Settings offers four durable policies: `background` checks 30 seconds after launch and every four hours thereafter, `startup` checks once after the same delay, `manual` checks only after an explicit action, and `disabled` performs no checks. The default is `background`. The main process publishes the closed `disabled`, `idle`, `checking`, `available`, `downloading`, `ready`, and `error` states; background up-to-date results and failures stay quiet, while manual results and actionable releases appear in the frame overlay and Settings.

An available release is not downloaded automatically. The user starts the download and separately chooses **Restart and install** after it reaches `ready`. The Desktop embedder passes `lifecycle: { kind: 'caller', attach, requestExit }`: `attach` receives the bounded shutdown before profile boot can yield, and `requestExit` routes an in-profile `appExit` to Electron. A shutdown requested during startup waits for the profile Context to be published before disposing it, then prevents the remaining updater, IPC, and window bootstrap from registering. Installation first stops updater scheduling and aborts application work; local cleanup failures are reported while later cleanup and Harness quiescence still proceed. Failure reporting is best-effort, so its own failure cannot interrupt later cleanup, quiescence, or native exit. Only successful cleanup and quiescence let the main process invoke the platform installer. After invocation, it waits up to the build-pinned two-minute limit for the native `before-quit-for-update` acknowledgement. Cleanup failure, disposal failure, or quiescence timeout prevents installer invocation; an installer handoff error or acknowledgement timeout makes Electron exit nonzero. Ordinary quit uses the same shutdown coordinator, and the single-instance lock prevents two desktop processes from racing over the update cache.

The first release that enables this channel is a seed release and must be installed manually. In-place updates begin with the next higher version. Rollback is released as another higher patch version rather than enabling downgrade, and Mac architectures use separate update channels so an x64 installation never selects an arm64 asset. The update and publication invariants are recorded in the [desktop automatic-updates Agent Note](../../.agents/notes/implemented/feature/2026-08-14-desktop-automatic-updates.md); the temporary platform-authenticity trade-off is owned by the [certificate-free release-mode decision](../../.agents/notes/implemented/process/2026-08-15-certificate-free-desktop-release-mode.md).

## Security posture

The renderer runs with `sandbox: true`, context isolation, Node integration disabled, and navigation confined to `dsh://app`. Electron allows every non-empty permission requested by the owning top-level `dsh://app` frame and denies requests from a different window, subframe, or origin. Operating-system privacy prompts, such as camera, microphone, or screen-recording authorization, remain under operating-system control. The preload exposes only request, cancellation, stream, native-save, and updater state/action operations. It owns the non-interactive-page press-and-drag gesture without exposing it to page JavaScript. Every IPC request is checked against the owning window, its top-level frame, and the application origin; request URLs are confined to `dsh://app`, bodies are bounded, filenames are reduced to basenames, drag coordinates are finite and bounded, and updater actions are narrowed to a fixed set. The updater accepts only validated build resources and an exact HTTPS GitHub Releases URL; the renderer validates every returned state before using it. External HTTP(S) links are handed to the operating system. The desktop carrier is trusted only after these checks and never opens the Web server.

The content security policy permits `unsafe-eval` because the shipped Cordis client evaluates configuration expressions. Remote scripts, embedded frames, objects, and network connections remain blocked by the other directives and the window navigation policy.

## Model Experience

None beyond the reused Web composition. The desktop carrier, native dialogs, and application origin add no model-visible prompt, message, tool, or schema content.

#### KV Cache effect

None. Desktop transport does not alter provider requests or their stable prefixes.

## Known Limitations and Deferred Work

- **Local packaging is host-native** — one invocation builds only the current operating system and architecture. CI supplies both Mac architectures plus Windows x64 and Linux x64; it does not produce a universal macOS application.
- **The `0.1.1` seed, `0.1.2`, and `0.1.3` releases are certificate-free** — macOS uses a stable ad-hoc designated requirement without identity authentication or notarization, while Windows omits Authenticode and `publisherName`; operating-system trust warnings remain possible. The source-controlled mode and reviewed-tag setting select `0.1.3` explicitly, and signed mode still fails when any required credential is absent.
- **Linux remains notification-only** — the `.tar.gz` has no safe platform installer to replace a running application, so Settings links to the GitHub Releases page for manual installation.
- **The seed release cannot update itself into existence** — users must manually install the first update-enabled version; only later versions can exercise the full channel.
- **The production workspace stays unpacked** — macOS and Linux retain pnpm's relative workspace links across virtual-store package directories, while Windows uses a hoisted deployment that NSIS can archive without expanding the linked dependency graph. ASAR packaging remains disabled, so the application is substantially larger than a bundled release artifact.
- **Profile patch HMR is disabled** — edits to the profile or home `cordis.patch.yml` require an application restart; settings edited through the product remain live.
- **Unary IPC responses are buffered** — request bodies retain the Connection carrier's 160 MiB maximum and non-streaming responses are materialized before returning to the renderer. Only the two long-lived event channels and native Session-log saves stream.
