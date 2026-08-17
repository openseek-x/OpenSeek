/** Validate Git tags that may publish a desktop release. */

const stableVersion = /^\d+\.\d+\.\d+$/
const releaseCandidateNumber = /^(?:0|[1-9]\d*)$/

/**
 * Check whether a Git tag may publish the supplied desktop package version.
 *
 * A stable desktop version accepts its own tag and a numeric release-candidate
 * suffix on the same version line. A prerelease desktop version accepts only
 * its exact tag.
 *
 * @param tag - Git tag selected by the release workflow.
 * @param version - Version from the desktop package manifest.
 * @returns Whether the tag names an allowed desktop release.
 */
export function isDesktopReleaseTag(tag: string, version: string): boolean {
  const exact = `dsh-v${version}`
  if (tag === exact) return true
  if (!stableVersion.test(version)) return false

  const prefix = `${exact}-rc.`
  return tag.startsWith(prefix) && releaseCandidateNumber.test(tag.slice(prefix.length))
}

/**
 * Reject a Git tag that does not name the supplied desktop package version.
 *
 * @param tag - Git tag selected by the release workflow.
 * @param version - Version from the desktop package manifest.
 * @returns Nothing when the tag is allowed.
 * @throws {Error} When the tag names another version line or malformed release candidate.
 */
export function assertDesktopReleaseTag(tag: string, version: string): void {
  if (isDesktopReleaseTag(tag, version)) return

  const expected = stableVersion.test(version)
    ? `dsh-v${version} or dsh-v${version}-rc.<number>`
    : `dsh-v${version}`
  throw new Error(`desktop release tag must be ${expected}; got ${tag}`)
}
