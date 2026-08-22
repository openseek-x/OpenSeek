# Agent Note: Stable fork releases after upstream synchronization

Status: implemented

English | [中文](2026-08-20-stable-fork-releases-after-upstream-sync.zh.md)

## Problem

An official DeepSeek Harness release carries the `dsh` family's prerelease version, while OpenSeek's desktop update channel uses a higher stable version. A merged source tree with those versions mixed across package manifests makes package resolution and update selection ambiguous, and the release tool rejects it. Certificate-free desktop publication also remains safe only when source names the one reviewed tag that may use it.

## Decision

An upstream synchronization keeps the official tag's complete source while retaining OpenSeek's desktop application, update package, workflows, and documentation. Before publishing, the release workflow normalizes every `dsh` family member with `release:dsh` to one OpenSeek stable version. `0.1.7` is the stable release that contains official `dsh-v0.1.1-rc.1`.

The desktop workflow keeps certificate-free mode bound to exactly one source-controlled stable tag, currently `dsh-v0.1.7`, as defined by the [certificate-free desktop release mode](2026-08-15-certificate-free-desktop-release-mode.md). A later stable release updates that tag, its workflow test, and the paired release documentation in the same source change; `signed` mode remains the path for certificate-backed publication.

## Alternatives considered

**Publish the official prerelease tag unchanged.** This would expose a lower prerelease version to a stable updater, which rejects prereleases and downgrades.

**Leave desktop-only packages at the preceding stable version.** This would preserve a mixed package family that the release tool rejects and would make a published package set internally inconsistent.

**Permit certificate-free publication for every later tag.** This would remove a version edit but would allow a weaker platform-identity policy to continue without a separate review.

## Consequences

OpenSeek release tags remain stable and monotonically higher than the installed desktop version, so `electron-updater` can select the next release normally. Every upstream sync that becomes a public release needs a full family version normalization and a reviewed desktop signing-mode update.

The daily upstream workflow still only prepares review branches; it never publishes or merges a release by itself.
