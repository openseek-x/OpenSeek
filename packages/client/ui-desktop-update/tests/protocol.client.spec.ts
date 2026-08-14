import { describe, expect, it } from 'vitest'
import {
  DESKTOP_UPDATE_ACTIONS,
  DESKTOP_UPDATE_DISABLED_REASONS,
  isDesktopUpdateAction,
  parseDesktopUpdateState,
} from '../src/protocol.ts'
import {
  DESKTOP_UPDATE_POLICIES,
  isDesktopUpdatePolicy,
} from '../src/update-settings.ts'
import { UPDATE_BASE, updateState } from './helpers.client.ts'

describe('desktop update protocol', () => {
  it('narrows every declared action, policy, and disabled reason', () => {
    expect(DESKTOP_UPDATE_ACTIONS).toEqual(['check', 'download', 'install', 'open-release'])
    expect(DESKTOP_UPDATE_DISABLED_REASONS).toEqual([
      'development',
      'updates-not-enabled',
      'unsupported-platform',
      'not-installed',
      'policy',
    ])
    expect(DESKTOP_UPDATE_POLICIES).toEqual(['background', 'startup', 'manual', 'disabled'])
    for (const action of DESKTOP_UPDATE_ACTIONS) expect(isDesktopUpdateAction(action)).toBe(true)
    for (const policy of DESKTOP_UPDATE_POLICIES) expect(isDesktopUpdatePolicy(policy)).toBe(true)
    expect(isDesktopUpdateAction('restart')).toBe(false)
    expect(isDesktopUpdatePolicy('always')).toBe(false)
  })

  it('accepts every updater state and both trusted Releases URL forms', () => {
    const states = [
      updateState({ status: 'disabled', reason: 'development' }),
      updateState({ status: 'idle' }),
      updateState({ status: 'idle', notice: 'up-to-date' }, { checkedAt: '2026-08-14T10:11:12Z' }),
      updateState({ status: 'checking', manual: false }),
      updateState({ status: 'available', updateVersion: '1.1.0' }),
      updateState(
        { status: 'available', updateVersion: '1.1.0', releaseDate: '2026-08-14T10:11:12.123Z' },
        { releaseUrl: 'https://github.com/openseek-x/OpenSeek/releases/latest' },
      ),
      updateState({
        status: 'downloading',
        updateVersion: '1.1.0',
        progress: { percent: 50.5, transferred: 50, total: 100, bytesPerSecond: 20 },
      }),
      updateState({ status: 'ready', updateVersion: '1.1.0' }),
      updateState({ status: 'error', message: 'network unavailable', manual: true }),
    ]
    for (const state of states) expect(parseDesktopUpdateState(state)).toBe(state)
  })

  it('rejects malformed common fields and untrusted release URLs', () => {
    const invalid: unknown[] = [
      null,
      [],
      'state',
      {},
      { ...UPDATE_BASE, status: 1 },
      { ...UPDATE_BASE, status: 'idle', revision: -1 },
      { ...UPDATE_BASE, status: 'idle', revision: 1.5 },
      { ...UPDATE_BASE, status: 'idle', revision: Number.MAX_SAFE_INTEGER + 1 },
      { ...UPDATE_BASE, status: 'idle', currentVersion: '' },
      { ...UPDATE_BASE, status: 'idle', currentVersion: 'v'.repeat(257) },
      { ...UPDATE_BASE, status: 'idle', policy: 'always' },
      { ...UPDATE_BASE, status: 'idle', checkedAt: 'August 14' },
      { ...UPDATE_BASE, status: 'idle', checkedAt: '2026-99-14T10:11:12Z' },
      { ...UPDATE_BASE, status: 'idle', checkedAt: '2026-02-30T10:11:12Z' },
      { ...UPDATE_BASE, status: 'idle', releaseUrl: 'not a url' },
      { ...UPDATE_BASE, status: 'idle', releaseUrl: 'http://github.com/o/r/releases' },
      { ...UPDATE_BASE, status: 'idle', releaseUrl: 'https://example.com/o/r/releases' },
      { ...UPDATE_BASE, status: 'idle', releaseUrl: 'https://github.com/o/r/releases/tag/v1' },
      { ...UPDATE_BASE, status: 'idle', releaseUrl: 'https://github.com/o/r/releases?q=1' },
      { ...UPDATE_BASE, status: 'idle', releaseUrl: 'https://github.com/o/r/releases#notes' },
      { ...UPDATE_BASE, status: 'idle', releaseUrl: `https://github.com/${'o'.repeat(500)}/r/releases` },
    ]
    for (const value of invalid) expect(() => parseDesktopUpdateState(value)).toThrow(TypeError)
  })

  it('rejects malformed fields for every discriminated state', () => {
    const progress = { percent: 50, transferred: 50, total: 100, bytesPerSecond: 20 }
    const invalid = [
      { ...UPDATE_BASE, status: 'future' },
      { ...UPDATE_BASE, status: 'disabled', reason: 'offline' },
      { ...UPDATE_BASE, status: 'idle', notice: 'quiet' },
      { ...UPDATE_BASE, status: 'checking', manual: 'yes' },
      { ...UPDATE_BASE, status: 'available', updateVersion: '' },
      { ...UPDATE_BASE, status: 'available', updateVersion: '1.1.0', releaseDate: 'today' },
      { ...UPDATE_BASE, status: 'downloading', updateVersion: '', progress },
      { ...UPDATE_BASE, status: 'downloading', updateVersion: '1.1.0', progress: null },
      { ...UPDATE_BASE, status: 'downloading', updateVersion: '1.1.0', progress: [] },
      { ...UPDATE_BASE, status: 'downloading', updateVersion: '1.1.0', progress: { ...progress, percent: 101 } },
      { ...UPDATE_BASE, status: 'downloading', updateVersion: '1.1.0', progress: { ...progress, percent: -1 } },
      { ...UPDATE_BASE, status: 'downloading', updateVersion: '1.1.0', progress: { ...progress, percent: Number.NaN } },
      { ...UPDATE_BASE, status: 'downloading', updateVersion: '1.1.0', progress: { ...progress, transferred: 101 } },
      { ...UPDATE_BASE, status: 'downloading', updateVersion: '1.1.0', progress: { ...progress, total: '100' } },
      { ...UPDATE_BASE, status: 'ready', updateVersion: '' },
      { ...UPDATE_BASE, status: 'error', message: '', manual: true },
      { ...UPDATE_BASE, status: 'error', message: 'x'.repeat(2_049), manual: true },
      { ...UPDATE_BASE, status: 'error', message: 'failed', manual: 1 },
    ]
    for (const value of invalid) expect(() => parseDesktopUpdateState(value)).toThrow(TypeError)
  })
})
