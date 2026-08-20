# Agent Note: Explicit certificate-free desktop release mode

Status: implemented

English | [中文](2026-08-15-certificate-free-desktop-release-mode.zh.md)

## Problem

The public desktop update path has its `0.1.1` seed and `0.1.2` successor, while Apple Developer ID, notarization, and Windows Authenticode credentials remain unavailable for `0.1.3`. Treating absent secrets as permission to emit certificate-free artifacts would silently weaken any later release whose credential configuration broke. Keeping certificate-free packaging manual would also prevent a normal `dsh-v0.1.3` tag from exercising the four-platform validation and atomic GitHub Release publisher.

## Decision

The desktop workflow declares the closed `DESKTOP_RELEASE_SIGNING_MODE` in version control as `certificate-free` or `signed`. Its current value is `certificate-free`, and `DESKTOP_CERTIFICATE_FREE_RELEASE_TAG` binds publication to the reviewed `dsh-v0.1.3` tag; a different release tag fails during classification. Manual dispatches use certificate-free packaging but never publish. Changing a future release to `signed` is an explicit source change, not a consequence of missing secrets. This decision temporarily supersedes the platform-certificate requirement in the [desktop automatic-updates decision](../feature/2026-08-14-desktop-automatic-updates.md).

Certificate-free Mac and Windows package jobs use the secret-free `desktop-package` Environment. The final publisher remains attached to `desktop-release`, requests `contents: write`, references no signing secret, and has no manual approval requirement for `0.1.3`. A tag must still match the stable desktop manifest version. Publication still waits for both Mac architectures, Windows x64, and Linux x64; validates the exact updater metadata and asset set; uploads to a draft; and makes that draft public only after every upload succeeds. Required reviewers, protected-tag deployment rules, and signing secrets are configured on `desktop-release` before the workflow mode changes to `signed`; the signed Mac and Windows package jobs then select that Environment.

The Mac package receives a deep ad-hoc signature and an outer designated requirement fixed to `identifier "ai.deepseek.harness"`. The workflow verifies the application and the updater ZIP after extraction against that same requirement. This preserves the requirement match needed by the updater across `0.1.1`, `0.1.2`, and `0.1.3`, but it authenticates no developer identity and performs no Apple notarization. Gatekeeper can warn or block a recipient until the user explicitly allows the application.

The Windows application and NSIS installer carry no Authenticode signature. Their `app-update.yml` omits `publisherName`, and the workflow proves both executables are `NotSigned`, so `electron-updater` performs no expected-publisher check for this release. SmartScreen can warn recipients. Linux remains a release-page download and has no in-place updater.

The `signed` branch remains fail-closed. It alone imports Apple or Windows credentials, requires every packaging environment value, verifies the notarized Mac application and Authenticode signatures, and adds the derived Windows certificate Subject as `publisherName`. Missing credentials cannot select certificate-free mode.

## Alternatives considered

**Fall back when a secret is absent.** This would keep a release moving through a credential outage, but it would turn a configuration failure into an unreviewed trust downgrade. The selected mode is declared and version-bound before any platform job starts.

**Publish artifacts from a manual workflow run.** Manual artifacts already exercise native packaging, but manually assembling a public Release would bypass the tag workflow's dependent four-platform result, exact-set validation, and draft-to-public transaction.

**Allow every future tag to remain certificate-free.** This would avoid a version-specific edit, but it would let a later release inherit the weaker identity policy without review. The configured certificate-free tag names `dsh-v0.1.3`, and the release check independently requires that tag to equal the desktop manifest version.

## Consequences

`dsh-v0.1.3` can exercise the ordinary tag-triggered build and update path from `0.1.2` without platform certificates. All architectures still succeed before one complete public Release appears, and the signed implementation remains present for an explicit future switch.

The released Mac and Windows bits provide transport hashes and updater metadata but no certificate-backed publisher authenticity. Users can encounter Gatekeeper or SmartScreen prompts, Windows does not compare an Authenticode publisher, and another certificate-free version requires a reviewed source change rather than only a version bump.
