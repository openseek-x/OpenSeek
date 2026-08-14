import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  SettingsProvider,
  settingsNamespace,
  type SettingsNamespace,
} from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_DESKTOP_UPDATE_POLICY,
  DESKTOP_UPDATE_SETTINGS_NAMESPACE,
  apply,
} from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-desktop-update Host plugin', () => {
  it('registers, validates, and disposes its durable namespace', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const namespace = settingsNamespace(DESKTOP_UPDATE_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(namespace)).toEqual({ policy: DEFAULT_DESKTOP_UPDATE_POLICY })

    await ctx.settings.update(namespace, { policy: 'manual' })
    expect(ctx.settings.get(namespace)).toEqual({ policy: 'manual' })
    await expect(ctx.settings.update(namespace, { policy: 'always' })).rejects.toThrow()

    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(namespace)
  })

  it('remains dormant when the settings capability is absent', async () => {
    const ctx = new Context()
    await ctx.plugin({ apply }).await()
    expect(ctx.get('settings')).toBeUndefined()
  })
})
