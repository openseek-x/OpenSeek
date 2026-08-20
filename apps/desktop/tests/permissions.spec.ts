import { describe, expect, it } from 'vitest'
import { desktopPermissionDecision } from '../src/permissions.ts'

describe('desktop clipboard permission', () => {
  it('allows sanitized clipboard writes from the owning application frame', () => {
    const owner = {}

    expect(desktopPermissionDecision(
      owner,
      owner,
      'clipboard-sanitized-write',
      'dsh://app/',
      true,
    )).toBe('allow')
  })

  it('allows other permissions from the owning application frame', () => {
    const owner = {}

    expect(desktopPermissionDecision(owner, owner, 'clipboard-read', 'dsh://app/', true)).toBe('allow')
    expect(desktopPermissionDecision(owner, owner, 'media', 'dsh://app/', true)).toBe('allow')
  })

  it.each([
    ['an empty permission', '', 'dsh://app/', true, true],
    ['a different renderer', 'clipboard-sanitized-write', 'dsh://app/', true, false],
    ['a subframe', 'clipboard-sanitized-write', 'dsh://app/', false, true],
    ['a remote origin', 'clipboard-sanitized-write', 'https://example.com/', true, true],
    ['a malformed URL', 'clipboard-sanitized-write', '%', true, true],
  ])('rejects %s', (_label, permission, url, isMainFrame, sameOwner) => {
    const owner = {}
    const requester = sameOwner ? owner : {}

    expect(desktopPermissionDecision(owner, requester, permission, url, isMainFrame)).toBe('deny')
  })
})
