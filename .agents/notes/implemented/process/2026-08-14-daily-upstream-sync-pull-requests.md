# Agent Note: Daily upstream synchronization pull requests

Status: implemented

English | [中文](2026-08-14-daily-upstream-sync-pull-requests.zh.md)

## Problem

OpenSeek carries desktop packaging, branding, and release automation on top of `deepseek-ai/deepseek-harness`. The official repository continues to change, but direct automated updates to OpenSeek's default branch could overwrite or invalidate those local decisions. Manual polling leaves security fixes and useful upstream changes undiscovered until a maintainer remembers to check.

## Decision

The [`Sync upstream`](../../../../.github/workflows/upstream-sync.yml) workflow checks `deepseek-ai/deepseek-harness` branch `master` every day at 22:00 in `Asia/Shanghai` and also supports manual dispatch. It fetches the official repository without tags and ends without a branch or pull request when that upstream commit is already contained in OpenSeek `main`.

When an update exists, the workflow permits only one open `upstream-sync/*` pull request at a time. It creates `upstream-sync/<12-character-upstream-SHA>` from the current OpenSeek `main`, records the upstream integration as a merge commit authored by `github-actions[bot]`, pushes only that review branch, and opens a labeled pull request against `main`. A pull request already associated with the same upstream commit is not recreated after it is closed. A merge conflict aborts before any branch is pushed, and the workflow never merges a pull request.

The job uses the repository-scoped `GITHUB_TOKEN` with explicit `contents: write`, `pull-requests: write`, and `issues: write` permissions; the last permission applies the repository's pull-request labels. Repository-wide default workflow permissions remain read-only. The repository setting that allows GitHub Actions to create or approve pull requests is enabled, but this workflow contains no approval or merge operation. The sync job performs Git and GitHub API operations only; it does not install dependencies or execute fetched upstream code.

The workflow contract is pinned by [`scripts/ci-workflow.spec.ts`](../../../../scripts/ci-workflow.spec.ts), including the Shanghai schedule, fixed repositories and branches, review-branch push, labels, conflict abort, and absence of automatic merge or direct `main` push.

## Alternatives considered

- **Merge and push official updates directly to `main`.** Rejected because a green upstream branch does not validate OpenSeek's desktop application, packaging, or release behavior.
- **Notify maintainers without preparing a branch.** Rejected because it preserves manual discovery and merge assembly even when Git can integrate the histories without a conflict.
- **Continuously force-update one synchronization branch.** Rejected because rewriting a reviewed branch can invalidate comments and hide which upstream commit a maintainer declined.
- **Use a personal access token or separate GitHub App.** Rejected for the current workflow because the repository-scoped token avoids a long-lived secret. Pull-request checks created through that token can require maintainer approval before running.

## Consequences

- Upstream changes arrive as explicit review decisions and never alter `main` without a maintainer merge.
- One open synchronization pull request blocks newer proposals until it is merged or closed; the next daily check then evaluates the newest official commit.
- Conflicts require a manual synchronization branch, while a closed pull request for an unchanged upstream commit remains closed instead of being recreated daily.
- A manual synchronization released to OpenSeek follows the [stable fork release normalization](2026-08-20-stable-fork-releases-after-upstream-sync.md); this workflow still neither publishes nor merges that branch.
- GitHub records one workflow run per day even when no update exists, and a run scheduled for 22:00 may start later when hosted scheduling is delayed.
- Enabling workflow-created pull requests expands what a workflow with explicit write permissions can do; read-only default permissions and the absence of approve or merge commands limit this workflow's authority.
