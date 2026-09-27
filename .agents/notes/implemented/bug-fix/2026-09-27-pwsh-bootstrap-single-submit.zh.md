# Agent Note: PowerShell 启动设置只提交一次

Status: implemented

[English](2026-09-27-pwsh-bootstrap-single-submit.md) | 中文

## Problem

Windows ConPTY shell 的首次 PowerShell 设置发送，可能在后端观察到 `stdin_read` 前，以空 viewport 的 `inferred_idle` 结算。若把空 viewport 当作尚未提交设置的证据，就会再次发送 UTF-8 与提示符源码。重复的设置回显可能填满有界 scrollback，并挤掉第一条用户命令的输出。已安装 Python SDK 的 minimal-agent 冒烟测试因此丢失了 `COUNT=1` 工具结果。

## Decision

PowerShell 启动独立于渲染输出记录设置是否已经提交。编码与提示符源码只提交一次，此后用不带文本的发送等待 `stdin_read`。整个序列继续共用一个绝对截止时间；退出、取消和清理沿用现有会话生命周期。空 viewport 既不是就绪证据，也不允许再次写入设置。

## Alternatives considered

**空 viewport 后重发设置。** 空 viewport 只说明目前渲染了什么，无法证明 PTY 是否已接收写入。慢启动的 shell 随后可能重复执行设置。

**输出静默后发布会话。** `inferred_idle` 无法证明 PowerShell 已读取设置或安装提示符。

## Consequences

PowerShell 慢启动时，第一条真实命令仍能保留输出。如果首次设置写入确实无法到达 shell，启动会触发已有截止时间，而不会发布未初始化的会话。空 viewport 单元用例在重复写入的旧行为上失败，在第二次发送不带输入时通过。已安装 wheel 的冒烟测试会经组装后的 Windows PTY 验证两次持久 shell 计数输出；仅 macOS 源码测试不能验收 Windows 路径。
