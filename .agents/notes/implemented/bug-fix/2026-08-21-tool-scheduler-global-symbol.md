# Agent Note: Tool scheduler identity across package copies

Status: implemented

English | [中文](2026-08-21-tool-scheduler-global-symbol.zh.md)

## Problem

The agent loop and Code Mode bridge access ToolRuntime's internal scheduler through a symbol-keyed member. A packaged application can resolve their `@deepseek-ai/dsh-tools` imports from separate deployed dependency closures, so a process-local `Symbol()` creates two keys and the consumer reads no scheduler.

## Decision

`TOOL_RUNTIME_SCHEDULER` uses `Symbol.for('@deepseek-ai/dsh-tools.scheduler')`. Every module copy in one JavaScript process therefore resolves the same internal member while the scheduler remains absent from the named service API.

## Alternatives considered

**Keep a process-local symbol.** Rejected because independently resolved package copies cannot address the same ToolRuntime member.

**Expose the scheduler as a named service method.** Rejected because the scheduler is an internal execution pipeline view, not a plugin extension point.

## Consequences

Packaged desktop and CLI compositions can execute Code Mode sub-dispatches even when their agent-loop and tool-registry modules come from different dependency paths. The Code Mode test asserts the globally registered key reaches the full scheduler view.
