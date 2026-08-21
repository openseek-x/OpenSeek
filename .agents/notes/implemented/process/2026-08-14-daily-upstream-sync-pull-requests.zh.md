# Agent Note: 每日上游同步 PR

Status: implemented

[English](2026-08-14-daily-upstream-sync-pull-requests.md) | 中文

## 问题

OpenSeek 在 `deepseek-ai/deepseek-harness` 的基础上承载桌面端打包、品牌和发布自动化。官方仓库会持续变化，但直接自动更新 OpenSeek 默认分支可能覆盖这些本地决策或使其失效。完全依靠人工检查，则会让安全修复和有用的上游变更一直无人发现，直到维护者主动想起检查。

## 决策

[`Sync upstream`](../../../../.github/workflows/upstream-sync.yml) 工作流每天在 `Asia/Shanghai` 时区的 22:00 检查 `deepseek-ai/deepseek-harness` 的 `master` 分支，也支持手动触发。它从官方仓库拉取更新但不拉取标签；如果 OpenSeek `main` 已包含该上游提交，工作流结束，不创建分支或 PR（Pull Request）。

存在更新时，工作流同一时间最多允许一个开放的 `upstream-sync/*` PR。它从当前 OpenSeek `main` 创建 `upstream-sync/<上游 SHA 前 12 位>`，以 `github-actions[bot]` 为作者创建上游集成合并提交，只推送该评审分支，再创建带标签且以 `main` 为目标的 PR。某个上游提交已有 PR 时，即使该 PR 已关闭也不会重复创建。发生合并冲突时，工作流会在推送任何分支前中止，而且永远不会合并 PR。

该任务使用仓库范围的 `GITHUB_TOKEN`，并显式获得 `contents: write`、`pull-requests: write` 和 `issues: write` 权限；最后一项权限用于添加仓库的 PR 标签。仓库的默认工作流权限仍保持只读。仓库已启用允许 GitHub Actions 创建或批准 PR 的设置，但本工作流不包含批准或合并操作。同步任务只执行 Git 和 GitHub API 操作，不安装依赖，也不执行刚拉取的上游代码。

[`scripts/ci-workflow.spec.ts`](../../../../scripts/ci-workflow.spec.ts) 锁定该工作流约定，包括上海时区的调度时间、固定仓库与分支、评审分支推送、标签、冲突中止，以及不得自动合并或直接推送 `main`。

## 考虑过的替代方案

- **将官方更新直接合并并推送到 `main`。** 不采用，因为上游分支通过自身检查，并不能验证 OpenSeek 桌面应用、打包和发布行为。
- **只通知维护者，不准备分支。** 不采用，因为即使 Git 能无冲突地集成两条历史，这仍然保留了人工发现更新和组装合并的工作。
- **持续强制更新同一个同步分支。** 不采用，因为重写已评审分支会使评论失效，还会掩盖维护者拒绝的是哪个上游提交。
- **使用个人访问令牌或独立 GitHub App。** 当前工作流不采用，因为仓库范围的令牌不需要长期密钥。通过该令牌创建的 PR 检查可能需要维护者批准后才能运行。

## 后果

- 上游变更会以明确的评审决策进入仓库；没有维护者合并，就不会改变 `main`。
- 一个开放的同步 PR 会阻止生成更新的提案，直到它被合并或关闭；随后下一次每日检查会评估官方仓库的最新提交。
- 冲突需要人工创建同步分支；若官方提交没有变化，已关闭的 PR 会保持关闭，不会每天重复创建。
- 发布到 OpenSeek 的人工同步遵循[稳定分叉版本发布规范](2026-08-20-stable-fork-releases-after-upstream-sync.zh.md)；该工作流仍不会发布或合并该分支。
- 即使没有更新，GitHub 每天也会记录一条工作流运行记录；受托管调度延迟影响，计划在 22:00 运行的任务可能稍晚开始。
- 启用由工作流创建 PR 的能力，会扩大具有显式写权限的工作流可执行的操作；默认只读权限以及不存在批准或合并命令，限制了本工作流的权限范围。
