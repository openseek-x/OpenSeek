# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

Electron application for the DeepSeek Harness graphical client. The main process boots the shipped `web` profile in-process, applies `config/desktop.patch.yml` to replace the HTTP server and browser-only rows, and opens the same built client composition used by `dsh web`. The renderer therefore keeps the Web product's sessions, settings, model selection, tools, and plugin UI without requiring a localhost port.

The built frontend and client plugin bundles are served from the secure `dsh://app/` application origin. Unary API and generic RPC requests cross a context-isolated preload bridge as structured-clone metadata and bytes; the two event channels stream chunks over the same bridge. The main process dispatches those Fetch-shaped requests through `HostConnectionService`, so the Host API remains the single implementation. Directory selection and Session-log export use native dialogs.

## Run and package

From the repository root:

```sh
pnpm run desktop
pnpm run package:desktop:mac
pnpm run test:desktop:packaged
```

`desktop` builds the repository and starts Electron from source. `package:desktop:mac` creates a self-contained application for the current Mac architecture at `dist-desktop/DeepSeek Harness-darwin-<arch>/DeepSeek Harness.app`; `test:desktop:packaged` starts that application, waits for the composed interface through a random loopback Chromium debugging port, and verifies clean signal shutdown.

A terminal launch keeps the terminal's current directory as the initial workspace. A Finder launch whose inherited working directory is `/` starts in the user's Documents directory; selecting another workspace in the application changes the active workspace in the normal way.

## Profiles, settings, and models

The desktop application shares the `web` profile and Harness home (`$DSH_HOME`, otherwise `~/.dsh`) with `dsh web`. Profile and home `cordis.patch.yml` files are composed at startup, but their file watchers are disabled because Electron does not expose the Node loader hook used by config HMR; restart the application after changing either patch file. The settings and credentials services remain part of the composition, so changes made through Settings, including model-provider changes, continue to apply through their own live services.

DeepSeek is the shipped default, not the only supported model family. The dormant `llm-pi-ai` adapter can be configured from Settings for installed catalog providers such as OpenAI, Anthropic, Google, OpenRouter, Mistral, Groq, and xAI, or for a fully declared OpenAI-compatible/self-hosted route. Authentication support varies by provider; see [`dsh-llm-pi-ai`](../../packages/llm/llm-pi-ai/README.md) for the authoritative catalog and protocol constraints.

## Security posture

The renderer runs with `sandbox: true`, context isolation, Node integration disabled, denied Electron permission requests, and navigation confined to `dsh://app`. The preload exposes only request, cancellation, stream, and native-save operations. Every IPC request is checked against the owning window, its top-level frame, and the application origin; request URLs are confined to `dsh://app`, bodies are bounded, and filenames are reduced to basenames. External HTTP(S) links are handed to the operating system. The desktop carrier is trusted only after these checks and never opens the Web server.

The content security policy permits `unsafe-eval` because the shipped Cordis client evaluates configuration expressions. Remote scripts, embedded frames, objects, and network connections remain blocked by the other directives and the window navigation policy.

## Model Experience

None beyond the reused Web composition. The desktop carrier, native dialogs, and application origin add no model-visible prompt, message, tool, or schema content.

#### KV Cache effect

None. Desktop transport does not alter provider requests or their stable prefixes.

## Known Limitations and Deferred Work

- **Packaging is macOS-only and host-architecture-only** — the current command emits either `darwin-arm64` or `darwin-x64`; Windows, Linux, and universal macOS artifacts are not assembled.
- **The development artifact is unsigned and unnotarized** — it also uses Electron's default application icon. Distribution outside the build machine needs signing, notarization, release metadata, and branded icon assets.
- **The production workspace stays unpacked** — pnpm's relative workspace links cross virtual-store package directories, so ASAR packaging is disabled. The resulting application is substantially larger than a bundled release artifact.
- **Profile patch HMR is disabled** — edits to the profile or home `cordis.patch.yml` require an application restart; settings edited through the product remain live.
- **Unary IPC responses are buffered** — request bodies retain the Connection carrier's 160 MiB maximum and non-streaming responses are materialized before returning to the renderer. Only the two long-lived event channels and native Session-log saves stream.
