# Agent Note: 显式无证书桌面 Release 模式

Status: implemented

[English](2026-08-15-certificate-free-desktop-release-mode.md) | 中文

## Problem

公开桌面更新路径已有 `0.1.1` seed、`0.1.2`、`0.1.3` 与 `0.1.4` 后继版本，而 Apple Developer ID、notarization 与 Windows Authenticode 凭据在 `0.1.5` 发布时仍不可用。如果把缺少 secret 当作生成无证书产物的许可，后续 Release 的凭据配置一旦损坏，就会静默削弱其安全性。若无证书打包只允许手动运行，普通 `dsh-v0.1.5` 标签也无法执行四平台校验与原子的 GitHub Release 发布流程。

## Decision

桌面工作流会在版本控制中把封闭的 `DESKTOP_RELEASE_SIGNING_MODE` 声明为 `certificate-free` 或 `signed`。其当前值为 `certificate-free`，`DESKTOP_CERTIFICATE_FREE_RELEASE_TAG` 会把发布绑定到经过审查的 `dsh-v0.1.5` 标签；其他 Release 标签会在分类阶段失败。手动运行使用无证书打包，但绝不会发布。后续 Release 改用 `signed` 必须显式修改源码，不能由缺少 secret 触发。本决策临时取代[桌面自动更新决策](../feature/2026-08-14-desktop-automatic-updates.zh.md)中的平台证书要求。

无证书 Mac 与 Windows 打包 job 使用不含 secret 的 `desktop-package` Environment。最终发布 job 仍绑定 `desktop-release`，请求 `contents: write`，不引用任何签名 secret，且 `0.1.5` 不要求人工审批。标签仍必须匹配稳定的桌面 manifest 版本。发布流程仍会等待两个 Mac 架构、Windows x64 与 Linux x64 全部完成，校验准确的更新元数据与产物集合，上传到草稿，并且只在全部上传成功后把草稿公开。工作流模式改成 `signed` 前，需要在 `desktop-release` 上配置 required reviewers、受保护标签 deployment rule 与签名 secret；届时 signed 模式的 Mac 与 Windows 打包 job 会选择该 Environment。

Mac 包会获得 deep ad-hoc 签名，外层 designated requirement 固定为 `identifier "ai.deepseek.harness"`。工作流会按照同一 requirement 校验应用及解压后的更新 ZIP。这样可以维持更新器跨 `0.1.1`、`0.1.2`、`0.1.3`、`0.1.4` 与 `0.1.5` 所需的 requirement 匹配，但不会认证开发者身份，也不会执行 Apple notarization。Gatekeeper 可能警告或阻止接收方，直到用户显式允许该应用。

Windows 应用与 NSIS 安装程序不带 Authenticode 签名。其 `app-update.yml` 会省略 `publisherName`，工作流也会证明两个可执行文件都是 `NotSigned`，因此 `electron-updater` 不会为该 Release 执行预期发布者检查。SmartScreen 可能向接收方发出警告。Linux 仍只提供 Release 页面下载，不支持原地更新。

`signed` 分支仍然快速失败。只有它会导入 Apple 或 Windows 凭据，要求所有打包环境值，校验经过 notarization 的 Mac 应用与 Authenticode 签名，并把推导出的 Windows 证书 Subject 加入 `publisherName`。缺少凭据不能选择无证书模式。

## Alternatives considered

**在缺少 secret 时回退。** 这可以让 Release 在凭据故障期间继续执行，却会把配置失败变成未经审查的信任降级。所选模式会在任何平台 job 开始前声明并绑定版本。

**从手动工作流运行发布产物。** 手动产物已经能执行原生打包，但手工组装公开 Release 会绕过标签工作流依赖的四平台结果、精确集合校验与草稿到公开事务。

**让以后所有标签都保持无证书。** 这可以省去版本专用编辑，却会让后续 Release 未经审查就继承较弱的身份策略。配置的无证书标签会具名 `dsh-v0.1.5`，Release 检查还会独立要求该标签等于桌面 manifest 版本。

## Consequences

`dsh-v0.1.5` 可以在没有平台证书的情况下执行普通标签触发构建，并完成从 `0.1.4` 的更新路径。所有架构仍会在一份完整的公开 Release 出现前成功，signed 实现也会保留，供未来显式切换。

发布的 Mac 与 Windows 二进制会提供传输 hash 与更新元数据，但不提供证书支持的发布者真实性。用户可能遇到 Gatekeeper 或 SmartScreen 提示，Windows 不会比较 Authenticode 发布者；另一个无证书版本需要经过审查的源码改动，不能只提升版本。
