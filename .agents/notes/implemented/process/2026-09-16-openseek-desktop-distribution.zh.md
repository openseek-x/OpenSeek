# Agent Note: OpenSeek Desktop 分发

Status: implemented

[English](2026-09-16-openseek-desktop-distribution.md) | 中文

## Problem

DeepSeek Harness 现已包含 Electron Desktop 应用，但 OpenSeek 无法使用其签名生产发布基础设施。如果不使用显式模式就发布新应用，运行时构建后会失败，或者在缺少凭据时削弱签名发布路径。

## Decision

OpenSeek 发布版本为 `0.1.9` 的完整上游 Desktop 实现和 `dsh` 包族。`OPENSEEK_DESKTOP_RELEASE=0.1.9` 会选择唯一经过审查的分发模式：macOS 资源与应用使用 ad-hoc 签名，Windows 产物保持未签名，electron-builder 为 `openseek-x/OpenSeek` 生成目标专用的 GitHub 更新元数据。发布工作流会在原生 runner 上构建 macOS arm64、macOS x64 和 Windows x64，校验发布标签，收集每个安装包和更新产物，记录校验和，并且只在全部打包任务成功后创建 GitHub Release。

选择器会校验 Desktop manifest 版本，因此后续 Release 不会仅因缺少签名变量就继承无证书发布。未设置该选择器的构建保留上游签名发布配置，并要求其 Apple 或 Windows 发布环境。

OpenSeek Issue 自动化与真实 API E2E 使用各自可选配置的凭据。缺少 App 凭据或 `DEEPSEEK_API_KEY_EXTERNAL` 时，每个工作流都会记录通知，并且只跳过受凭据保护的操作；普通无密钥 CI 检查仍然必须通过。

Fork CI 使用 GitHub 托管的 `ubuntu-24.04` 和 `windows-2025` runner。只有上游仓库保留其高配、自托管和 Blacksmith runner 选择。

Fork 也会按托管 runner 的容量降低快照门禁并行度。这样可以避免上游 16 核任务中 32 个并发快照进程导致 profile 启动超时；上游保持该高吞吐设置。

Fork 覆盖率采用两个分片、每个分片两个 worker，并串行调度门禁。这可以避免上游 16 核配置在托管 runner 上产生内存和调度竞争，同时保留完整的覆盖率门禁。

DeepSeek 默认值的预期输出测试夹具会维持流式响应，直到 one-shot 进程在托管 runner 上发出后台标题请求。现有断言仍要求同时收到 Agent 请求和标题请求。

Cloudflare 预览部署会保持关闭，直到 OpenSeek 设置 `DSH_CLOUDFLARE_PREVIEW_ENABLED=true`。这个显式变量避免 fork 把构建产物发送到上游 Pages 项目；启用预览需要配置工作流已命名的 Cloudflare 部署和 Access 密钥。

## Alternatives considered

**仅发布本地 macOS 安装包。** 这会更快提供 Desktop，但会使 Windows 产品和发布流程未得到验证。

**把缺少证书视为无证书发布请求。** 临时凭据故障可能悄然把签名 Release 替换为信任更弱的产物。

**保留原有 OpenSeek Electron 壳。** 它使用了不兼容的后端和客户端传输方式，无法安全承载当前上游 Desktop 运行时。

## Consequences

用户可以从 OpenSeek Release 下载匹配的 macOS 和 Windows 安装程序。由于安装包不提供平台发布者身份，Gatekeeper 和 SmartScreen 可能会显示警告。`0.1.9` 之后的 Release 必须审查并修改发布值、测试、工作流和文档；取得平台证书仍是进行可信分发的路径。
