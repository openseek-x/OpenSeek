# Agent Note: Desktop 工作区目录浏览器

Status: implemented

[English](2026-09-17-desktop-workspace-directory-browser.md) | 中文

## 问题

Desktop Host 在子进程中运行 macOS 的 `osascript choose folder` 后端。原生对话框可能留在 Electron 窗口后方，使工作区流程保持忙碌却没有可见的目录选择控件。

## 决策

Desktop overlay 挂载 `dsh-host-directory-picker-browse` 和 `dsh-client-ui-directory-picker-browse`。工作区流程现在在 Electron 应用内渲染目录浏览器，并使用 Host 的目录列表与子目录创建 RPC。私有 Desktop Host 直接声明这两个 browse 包，确保打包运行时包含已选择的组合。

## 考虑过的替代方案

**激活 macOS AppleScript 对话框。** 即使将独立选择框带到前台，它仍不是 Electron 窗口的子项，Desktop 流程依然依赖平台特定的前台规则。

**新增 Electron 专用对话框 RPC。** 这会在 Desktop 专用协议后重复目录选择 capability。browse 后端已经拥有相同的工作区选择语义，同时不会向 Client 暴露 Electron IPC。

**在非 macOS 目标保留原生后端。** 不同的交互表面会让 Desktop profile 保留不可稳定验证的原生路径。应用内浏览器可在所有支持的 Desktop 目标上运行。

## 后果

Desktop 用户通过应用内对话框选择工作区，可浏览目录并新建一个子文件夹。对话框占用应用内空间，不再打开操作系统选择框。Host 仍只为本机当前用户读取目录，选择过程保持在 Desktop Host 传输内。

Desktop 组合测试固定 browse 包并排除 native 包。browse 包的组件测试覆盖目录确认与取消。已打包 Desktop 运行时测试会选择一个真实的临时目录。

## 相关

[Win32 原生选择器前台决策](2026-09-07-win32-picker-foreground-alt-key.zh.md)仍然适用于在 Desktop 之外显式组合 native 后端的部署。
