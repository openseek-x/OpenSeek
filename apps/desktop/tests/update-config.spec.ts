import { describe, expect, it } from 'vitest'
import {
  configureDesktopUpdater,
  DEFAULT_DESKTOP_UPDATE_RUNTIME_CONFIG,
  parseDesktopUpdateRuntimeConfig,
} from '../src/update-config.ts'

const valid = { ...DEFAULT_DESKTOP_UPDATE_RUNTIME_CONFIG, enabled: true }

describe('parseDesktopUpdateRuntimeConfig', () => {
  it('accepts the exact signed release configuration', () => {
    expect(parseDesktopUpdateRuntimeConfig(valid)).toEqual(valid)
  })

  it.each([
    null,
    [],
    { ...valid, extra: true },
    { ...valid, version: 2 },
    { ...valid, enabled: 'true' },
    { ...valid, owner: '' },
    { ...valid, owner: '.' },
    { ...valid, owner: 'owner/name' },
    { ...valid, repository: 'r'.repeat(101) },
    { ...valid, repository: 'repo name' },
    { ...valid, channel: '../latest' },
    { ...valid, channel: 'x'.repeat(65) },
    { ...valid, startupDelayMs: 999 },
    { ...valid, startupDelayMs: 1_800_001 },
    { ...valid, intervalMs: 899_999 },
    { ...valid, intervalMs: 604_800_001 },
    { ...valid, noticeDurationMs: 999 },
    { ...valid, noticeDurationMs: 60_001 },
    { ...valid, installHandoffTimeoutMs: 9_999 },
    { ...valid, installHandoffTimeoutMs: 600_001 },
  ])('rejects malformed or unsupported input %#', (candidate) => {
    expect(() => parseDesktopUpdateRuntimeConfig(candidate)).toThrow('desktop-update.json is invalid')
  })
})

describe('configureDesktopUpdater', () => {
  it('restores the downgrade guard after the channel setter changes it', () => {
    const target = {
      allowDowngrade: false,
      allowPrerelease: true,
      autoDownload: true,
      autoInstallOnAppQuit: true,
      selectedChannel: null as string | null,
      get channel(): string | null {
        return this.selectedChannel
      },
      set channel(value: string | null) {
        this.selectedChannel = value
        this.allowDowngrade = true
      },
    }

    configureDesktopUpdater(target, 'latest-arm64')

    expect(target.channel).toBe('latest-arm64')
    expect(target.allowDowngrade).toBe(false)
    expect(target.allowPrerelease).toBe(false)
    expect(target.autoDownload).toBe(false)
    expect(target.autoInstallOnAppQuit).toBe(false)
  })
})
