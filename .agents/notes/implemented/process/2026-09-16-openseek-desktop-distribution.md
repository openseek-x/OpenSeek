# Agent Note: OpenSeek Desktop distribution

Status: implemented

English | [中文](2026-09-16-openseek-desktop-distribution.zh.md)

## Problem

DeepSeek Harness now includes an Electron Desktop application, but its signed production release infrastructure is not available to OpenSeek. Releasing the new application without an explicit mode would either fail after the runtime build or weaken the signed path when credentials are absent.

## Decision

OpenSeek ships the upstream Desktop implementation with the complete `dsh` family at version `0.1.9`. `OPENSEEK_DESKTOP_RELEASE=0.1.9` selects the one reviewed distribution: macOS resources and the application use ad-hoc signatures, Windows artifacts remain unsigned, and electron-builder emits target-specific GitHub updater metadata for `openseek-x/OpenSeek`. The release workflow builds macOS arm64, macOS x64, and Windows x64 on native runners, verifies the release tag, collects every installer and updater asset, records checksums, and creates the GitHub Release only after every package job succeeds.

The selector checks the Desktop manifest version, so a later release cannot inherit certificate-free publication solely because signing variables are absent. Builds without the selector retain the upstream signed release configuration and require its Apple or Windows release environment.

OpenSeek issue automation and real-API E2E use their own opt-in credentials. Each workflow records a notice and skips only the credential-protected operation when its App credentials or `DEEPSEEK_API_KEY_EXTERNAL` are absent; the ordinary keyless CI checks remain required.

Fork CI uses GitHub-hosted `ubuntu-24.04` and `windows-2025` runners. The upstream repository alone retains its high-capacity, self-hosted, and Blacksmith runner selections.

The fork also scales snapshot gate parallelism to the hosted runner capacity. This avoids profile-startup timeouts caused by the upstream 16-core lane's 32 concurrent snapshot processes; upstream keeps that higher throughput setting.

The DeepSeek-default expected-output fixture keeps its streaming response open until the one-shot process issues its background title request on hosted runners. The existing assertion still requires both the agent request and the title request.

Cloudflare preview deployment is disabled until OpenSeek sets `DSH_CLOUDFLARE_PREVIEW_ENABLED=true`. That explicit variable prevents a fork from sending build output to the upstream Pages project; enabling it requires the Cloudflare deployment and Access secrets the workflow already names.

## Alternatives considered

**Publish only a local macOS package.** This would make the Desktop available sooner but would leave the Windows product and release pipeline unqualified.

**Treat missing certificates as an unsigned release request.** A temporary credential outage could silently replace a signed release with a weaker artifact.

**Keep the previous OpenSeek Electron shell.** It uses an incompatible backend and client transport, so it cannot carry the current upstream desktop runtime safely.

## Consequences

Users can download matching macOS and Windows installers from the OpenSeek release. Gatekeeper and SmartScreen can warn because the packages do not establish a platform publisher identity. A release after `0.1.9` requires a reviewed source change to the release value, test, workflow, and documentation; obtaining platform certificates remains the path to authenticated distribution.
