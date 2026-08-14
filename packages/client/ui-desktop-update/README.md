# @deepseek-ai/dsh-client-ui-desktop-update

English | [中文](README.zh.md)

Desktop update preference and presentation plugin. Its Host half only registers the `desktop-update` settings namespace and defaults `policy` to `background`; it adds no Cordis Context service. The Electron main process reads the resolved policy from the generic settings service and observes `settings/updated`. The browser half binds the same namespace through `ctx.settingsScope`, then contributes a policy/status row to `settings.general.item` and a dismissible, non-modal notice to `shell.overlay`.

The browser half is intended only for the Desktop patch. It requires the context-isolated `globalThis.dshDesktopUpdate` bridge at activation and fails loud when the bridge is absent. The default Web composition does not mount this plugin; `dsh-web-app` carries the package only so a Desktop patch over that bundle can resolve its client module.

## Check policies

| `policy` | Electron behavior |
|---|---|
| `background` | Check after the packaged app starts and continue on the configured interval. |
| `startup` | Check once after startup. |
| `manual` | Check only after an explicit user action. |
| `disabled` | Stop scheduled checks while retaining the setting needed to re-enable them. |

The main process remains the authority for `disabled`, `idle`, `checking`, `available`, `downloading`, `ready`, and `error` states. The renderer may request `check`, `download`, `install`, or `open-release`; it never receives updater or filesystem access. Download and restart are explicit user actions. Background no-update results and errors remain in the Settings row, while manual checks and actionable update states may also appear in the overlay.

Every main-process state carries a monotonic `revision`. The renderer subscribes before requesting its initial snapshot and rejects replies no newer than the state already observed, so an IPC reply cannot roll the UI back behind an intervening event. The preload validates every snapshot, including the policy, progress bounds, ISO timestamps, and an HTTPS `github.com/<owner>/<repo>/releases` URL, before it reaches this package.

## Model Experience

None, as Desktop update settings and notices are application chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Desktop composition only** — mounting the browser half without the Electron preload bridge rejects activation; ordinary browser deployments must omit the plugin.
- **No in-place Linux update** — the Electron owner reports Linux archives as unsupported, so this package presents the trusted Releases page instead of download-and-install controls.
- **Dismissal is session-local** — dismissing an update phase suppresses later progress revisions for the same version; a phase change such as download completion appears again. The dismissal resets when the component remounts and is not durable across an app restart.
