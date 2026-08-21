# Agent Note: 工具调度器跨包副本的身份

Status: implemented

[English](2026-08-21-tool-scheduler-global-symbol.md) | 中文

## Problem

agent loop 和 Code Mode bridge 通过 symbol 键成员访问 ToolRuntime 的内部调度器。打包后的应用可能从不同的已部署依赖闭包解析它们的 `@deepseek-ai/dsh-tools` import，因此进程私有的 `Symbol()` 会创建两个键，消费者读不到调度器。

## Decision

`TOOL_RUNTIME_SCHEDULER` 使用 `Symbol.for('@deepseek-ai/dsh-tools.scheduler')`。同一 JavaScript 进程中的每个模块副本因此都会解析到同一个内部成员，而调度器仍不出现在具名 service API 中。

## Alternatives considered

**保留进程私有 symbol。** 不采用，因为独立解析的包副本无法寻址同一个 ToolRuntime 成员。

**将调度器公开为具名 service 方法。** 不采用，因为调度器是内部执行流水线视图，不是插件扩展点。

## Consequences

即使 agent-loop 与工具注册表模块来自不同依赖路径，打包后的桌面端和 CLI 组合仍可执行 Code Mode 子分派。Code Mode 测试断言全局注册键能访问完整调度器视图。
