# Agent Note: PowerShell bootstrap submits once

Status: implemented

English | [中文](2026-09-27-pwsh-bootstrap-single-submit.zh.md)

## Problem

A Windows ConPTY shell can settle its first PowerShell setup send as `inferred_idle` with an empty viewport before the backend observes `stdin_read`. Treating an empty viewport as proof that setup was not submitted sends the UTF-8 and prompt source again. Repeated setup echoes can fill bounded scrollback and displace the first user command's output. The installed Python SDK's minimal-agent smoke exposed this as a missing `COUNT=1` tool result.

## Decision

PowerShell startup tracks whether it submitted setup independently of rendered output. It submits the encoding and prompt source once, then uses empty follow-up sends while waiting for `stdin_read`. The complete sequence retains one absolute deadline, and exit, cancellation, and cleanup follow the existing session lifecycle. An empty viewport is not readiness and does not authorize a second setup write.

## Alternatives considered

**Resubmit after an empty viewport.** An empty viewport reports only what has been rendered so far; it does not show whether the PTY accepted the write. Retrying can execute the setup repeatedly after a slow shell starts.

**Publish after output silence.** `inferred_idle` does not prove that PowerShell read the submitted setup or installed the prompt.

## Consequences

The first real command keeps its output when PowerShell startup is slow. If the initial setup write truly cannot reach the shell, startup reaches its existing deadline instead of publishing an uninitialized session. A unit case with an empty first viewport fails on the repeated-write behavior and passes when the second send carries no input. The installed-wheel smoke exercises the assembled Windows PTY and requires both persistent-shell counter outputs; a macOS source test alone does not qualify the Windows path.
