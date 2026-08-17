import { describe, expect, it } from 'vitest'
import { assertDesktopReleaseTag, isDesktopReleaseTag } from '../scripts/release-tag.ts'

describe('desktop release tag', () => {
  it('accepts the stable tag and release candidates on the same version line', () => {
    expect(isDesktopReleaseTag('dsh-v0.1.0', '0.1.0')).toBe(true)
    expect(isDesktopReleaseTag('dsh-v0.1.0-rc.7', '0.1.0')).toBe(true)
    expect(() => {
      assertDesktopReleaseTag('dsh-v0.1.0-rc.7', '0.1.0')
    }).not.toThrow()
  })

  it('rejects other version lines, malformed release candidates, and suffixes on prerelease manifests', () => {
    expect(isDesktopReleaseTag('dsh-v0.1.1-rc.7', '0.1.0')).toBe(false)
    expect(isDesktopReleaseTag('dsh-v0.1.0-rc.07', '0.1.0')).toBe(false)
    expect(isDesktopReleaseTag('dsh-v0.1.0-rc.preview', '0.1.0')).toBe(false)
    expect(isDesktopReleaseTag('dsh-v0.1.0-rc.7-rc.8', '0.1.0-rc.7')).toBe(false)
    expect(() => {
      assertDesktopReleaseTag('dsh-v0.1.1-rc.7', '0.1.0')
    }).toThrow(
      'desktop release tag must be dsh-v0.1.0 or dsh-v0.1.0-rc.<number>',
    )
  })
})
