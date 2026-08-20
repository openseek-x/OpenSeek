# Agent Note: 上游同步后的稳定分叉版本发布

Status: implemented

[English](2026-08-20-stable-fork-releases-after-upstream-sync.md) | 中文

## Problem

官方 DeepSeek Harness Release 会给 `dsh` 包族使用预发布版本，而 OpenSeek 的桌面更新通道使用更高的稳定版本。如果合并后的源码树让包清单混用这两种版本，包解析与更新选择都会变得不明确，发布工具也会拒绝它。无证书桌面发布也只有在源码具名允许的唯一审查标签时才安全。

## Decision

上游同步保留官方标签的完整源码，同时保留 OpenSeek 的桌面应用、更新包、工作流和文档。发布前，发布流程通过 `release:dsh` 把每个 `dsh` 包族成员规范为一个 OpenSeek 稳定版本。`0.1.3` 是包含官方 `dsh-v0.1.0-rc.8` 的稳定 Release。

桌面工作流仍按照[无证书桌面 Release 模式](2026-08-15-certificate-free-desktop-release-mode.md)把无证书模式绑定到唯一一个由源码控制的稳定标签，目前为 `dsh-v0.1.3`。后续稳定 Release 会在同一处源码变更中更新该标签、工作流测试和成对的发布文档；`signed` 模式仍是使用证书支持的发布路径。

## Alternatives considered

**原样发布官方预发布标签。** 这会把更低的预发布版本暴露给稳定更新器，而更新器会拒绝预发布版本和降级。

**让仅桌面包保持前一稳定版本。** 这会保留发布工具拒绝的混合包族，也会使公开的包集合内部不一致。

**允许以后所有标签无证书发布。** 这会省去版本编辑，却会让较弱的平台身份策略在没有单独审查的情况下延续。

## Consequences

OpenSeek 发布标签保持稳定且单调高于已安装的桌面版本，因此 `electron-updater` 可以正常选择下一版本。每个要成为公开 Release 的上游同步都需要完整包族版本规范化和经过审查的桌面签名模式更新。

每日上游同步工作流仍只准备评审分支；它不会自行发布或合并 Release。
