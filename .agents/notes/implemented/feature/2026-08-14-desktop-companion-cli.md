# Agent Note: Desktop companion CLI with a pinned package manager

Status: implemented

English | [中文](2026-08-14-desktop-companion-cli.zh.md)

## Problem

The desktop distribution embeds the Host and graphical client but does not give a desktop-only installation a supported way to run `dsh`. Installing or updating an external profile bundle consequently requires a separate Node.js installation, a separately versioned CLI, and pnpm on `PATH`, even though the application already carries the matching CLI and profile runtime. That split hides plugin management from the installation path most graphical users follow and can let the package manager's behavior drift from the released application.

## Decision

`@deepseek-ai/dsh` declares the repository's pinned pnpm version as a runtime dependency. The plugin command resolves that pnpm entry from its own installation and launches it through `process.execPath`; it never searches `PATH` for a package manager. Ordinary npm installations use their Node executable, while the desktop companion sets `ELECTRON_RUN_AS_NODE=1` and uses the packaged Electron executable for both the CLI and pnpm processes.

Every profile boot anchors bare-package resolution at that profile's manifest. Node and Electron therefore search the profile's out-of-tree dependencies before the healed installation dependency closure in `$DSH_HOME/profiles/node_modules`, independent of workspace hoisting or the desktop package layout.

The desktop packager writes one thin public launcher beside the application executable: `Contents/MacOS/dsh` inside a macOS application, `dsh.cmd` in a Windows installation directory, and `dsh` at the Linux archive root. It also writes private `node` and `pnpm` shims under the application resources and prepends that directory only to the companion process tree, so package lifecycle scripts can resolve the embedded runtime and pinned package manager. Each launcher addresses deployed files by relative paths, and the POSIX launcher follows its own symbolic-link target, so moving or linking the application preserves the connection between the launcher, CLI, in-box bundles, and package manager. The companion and graphical application use the same `$DSH_HOME` and profiles. The launchers and shims are injected before native application signing so they remain inside the signed application payload.

Desktop containers do not add directories to `PATH` or edit shell startup files. DMG drag installation and Linux archive extraction have no trustworthy cross-platform install transaction for that mutation, and silently changing a user's shell configuration would exceed application-install authority. Users invoke the installed path directly or create their own link in a directory already on `PATH`.

Profile package mutations remain restart-scoped in the desktop application. Users quit the application before `add`, `update`, or `remove` and reopen it afterward; the companion does not attempt to hot-swap code in the running Electron process. Package lifecycle scripts retain the existing pnpm trust model and execute with host user authority outside the agent sandbox.

## Verification

The built-CLI acceptance installs a local bundle with an empty `PATH`, proving the plugin command reaches its declared pnpm dependency instead of a host command. The Node compatibility startup smoke boots the built Web composition from a fresh Harness home, proving its in-box bare plugins resolve through the healed installation dependency closure. The packaged-desktop smoke test locates the platform launcher, clears `PATH`, invokes the POSIX launcher through a symbolic link, checks the companion and private `node` and `pnpm` commands, installs and activates a local profile bundle, then starts and inspects the graphical application. Native packaging jobs exercise that path on both macOS architectures, Windows x64, and Linux x64. Installing each container and exercising a user-managed Windows `PATH` remain recipient-machine coverage gaps.

## Alternatives considered

**Keep the npm CLI as a separate prerequisite.** This preserves the smallest desktop artifact, but leaves desktop-only users without plugin management and permits CLI and package-manager versions to diverge from the application they modify.

**Add package installation directly to the graphical settings page.** A UI can eventually call the same package-management mechanism, but it also needs progress streaming, lifecycle-script trust decisions, restart coordination, and recovery from partial package-manager failures. The companion establishes one tested implementation before adding another presentation.

**Modify `PATH` automatically.** Windows has an installer transaction, but DMG and tar extraction do not, and shell startup files vary across users and shells. Platform-specific implicit mutations would make installation behavior asymmetric and difficult to reverse safely.

**Ship a second standalone Node runtime.** This avoids Electron's Node mode but duplicates a large runtime already present in every desktop artifact and creates another version and vulnerability-update obligation.

## Consequences

A desktop installation carries a relocatable, version-matched CLI that can manage external profile bundles without system Node.js or pnpm. The npm CLI also gains deterministic package-manager behavior across hosts. The same profile files continue to serve browser, desktop, and command-line launches.

The pnpm payload increases the CLI and desktop installation sizes. The companion is not automatically available under the bare name `dsh` until the user places or links it on `PATH`, and Electron's embedded Node runtime remains part of the CLI execution path. Plugin installation remains an explicitly trusted host operation and desktop composition changes still require a restart.
