# Agent Note: Desktop workspace directory browser

Status: implemented

English | [中文](2026-09-17-desktop-workspace-directory-browser.zh.md)

## Problem

The Desktop Host ran macOS's `osascript choose folder` backend in a child process. The native dialog could remain behind the Electron window, leaving the Workspace flow busy without a visible directory control.

## Decision

The Desktop overlay mounts `dsh-host-directory-picker-browse` and `dsh-client-ui-directory-picker-browse`. The Workspace flow now renders its directory browser inside the Electron application and uses the Host's directory-listing and child-directory-creation RPCs. The private Desktop Host declares both browse packages directly so the packaged runtime contains the selected composition.

## Alternatives considered

**Activate the macOS AppleScript dialog.** Bringing a separate chooser forward does not make it a child of the Electron window and leaves the Desktop flow dependent on platform-specific foreground rules.

**Add an Electron-only dialog RPC.** That would duplicate the directory-picker capability behind a Desktop-specific protocol. The browse backend already owns the same workspace selection semantics without exposing Electron IPC to the Client.

**Keep the native backend on non-macOS targets.** Different interaction surfaces would preserve an untestable native path in the Desktop profile. The in-app browser works on every supported Desktop target.

## Consequences

Desktop users choose Workspaces through an in-app dialog that lists directories and can create one child folder. The dialog occupies application space instead of opening an operating-system chooser. The Host still reads directories only for the active user on the local machine, and the selection stays within the Desktop Host transport.

The Desktop composition test pins the browse packages and excludes the native packages. The browse package's component tests cover directory confirmation and cancellation. A packaged Desktop runtime test exercises selecting a real temporary directory.

## Related

The [Win32 native picker foreground decision](2026-09-07-win32-picker-foreground-alt-key.md) remains authoritative for deployments that explicitly compose the native backend outside Desktop.
