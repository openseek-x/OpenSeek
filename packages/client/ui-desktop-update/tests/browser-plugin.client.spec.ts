import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import {
  stubSettingsScope,
  usePinnedBrowserLanguages,
} from '@deepseek-ai/dsh-client-test-runtime'
import type { DesktopUpdateBridge, DesktopUpdateState } from '../src/protocol.ts'
import type { DesktopUpdateSettings } from '../src/update-settings.ts'
import { UpdateSettingsRow, type UpdateSettingsRowInjected } from '../src/client/UpdateSettingsRow.tsx'
import { UpdateToast, type UpdateToastInjected } from '../src/client/UpdateToast.tsx'
import { apply, inject } from '../src/client/index.ts'
import { updateState } from './helpers.client.ts'

usePinnedBrowserLanguages('zh-CN')

afterEach(() => {
  vi.unstubAllGlobals()
})

function desktopBridge(initial: DesktopUpdateState = updateState({ status: 'idle' })) {
  let listener: ((state: DesktopUpdateState) => void) | undefined
  const off = vi.fn()
  const act = vi.fn<DesktopUpdateBridge['act']>(() => Promise.resolve(initial))
  const bridge: DesktopUpdateBridge = {
    getState: vi.fn(() => Promise.resolve(initial)),
    act,
    onState: vi.fn((next: (state: DesktopUpdateState) => void) => {
      listener = next
      return off
    }),
  }
  return { act, bridge, off, emit: (state: DesktopUpdateState) => { listener?.(state) } }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  ctx.provide('connection', {} as never)
  ctx.provide('remote', {} as never)
  const settings = stubSettingsScope<DesktopUpdateSettings>()
  const bind = vi.fn(() => settings.scope)
  ctx.provide('settingsScope', { bind } as never)
  const desktop = desktopBridge()
  vi.stubGlobal('dshDesktopUpdate', desktop.bridge)
  return {
    ctx,
    slots: ctx.get('slots') as SlotRegistry,
    locale,
    settings,
    bind,
    desktop,
  }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.general.item': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-desktop-update browser plugin', () => {
  it('declares every service the settings scope and two slots use', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('registers both surfaces before or after their declarations', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.slots.entries('settings.general.item')[0]).toMatchObject({
      component: UpdateSettingsRow,
      options: { id: 'desktop-update', order: 30 },
    })
    expect(before.slots.entries('shell.overlay')[0]).toMatchObject({
      component: UpdateToast,
      options: { id: 'desktop-update', order: 10 },
    })
    before.locale.setLocale('zh')
    expect(before.locale.bind('desktop.update')('row.title')).toBe('自动更新')
    before.locale.setLocale('en')
    expect(before.locale.bind('desktop.update')('row.title')).toBe('Automatic updates')

    const after = await bench()
    const fiber = after.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(after.slots.entries('settings.general.item')).toHaveLength(0)
    expect(after.slots.entries('shell.overlay')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('settings.general.item')).toHaveLength(1)
    expect(after.slots.entries('shell.overlay')).toHaveLength(1)
  })

  it('injects the bridge projection, policy scope, and actions', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.bind).toHaveBeenCalledWith({ namespace: 'desktop-update' })
    const rowEntry = b.slots.entries('settings.general.item')[0]!
    const row = (rowEntry.inject as unknown as () => UpdateSettingsRowInjected)()
    const toastEntry = b.slots.entries('shell.overlay')[0]!
    const toast = (toastEntry.inject as unknown as () => UpdateToastInjected)()
    expect(row.hooks.update).toBe(toast.hooks.update)
    expect(row.hooks.updatePolicy).toBe(b.settings.scope)

    row.setPolicy('manual')
    expect(b.settings.set).toHaveBeenCalledWith('policy', 'manual')
    row.check()
    row.download()
    row.install()
    row.openReleasePage()
    toast.check()
    toast.download()
    toast.install()
    await vi.waitFor(() => {
      expect(b.desktop.act.mock.calls.map(call => call[0])).toEqual([
        'check', 'download', 'install', 'open-release', 'check', 'download', 'install',
      ])
    })

    const next = updateState({ status: 'available', updateVersion: '1.2.0' }, { revision: 2 })
    b.desktop.emit(next)
    expect(row.hooks.update.getSnapshot()).toEqual(next)
  })

  it('recovers both registrations after their declaring entry is replaced', async () => {
    const b = await bench()
    const release = declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    release()
    expect(b.slots.entries('settings.general.item')).toHaveLength(0)
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
    declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('settings.general.item')).toHaveLength(1)
    expect(b.slots.entries('shell.overlay')).toHaveLength(1)
  })

  it('collapses entries, dictionaries, and the bridge listener on teardown', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('settings.general.item')).toHaveLength(0)
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
    expect(b.locale.bind('desktop.update')('row.title')).toBe('row.title')
    expect(b.desktop.off).toHaveBeenCalledOnce()
  })

  it('fails loud when mounted without the Electron preload bridge', async () => {
    const b = await bench()
    vi.unstubAllGlobals()
    declare(b.slots)
    expect(() => { apply(b.ctx) }).toThrow(/bridge is unavailable/)
  })
})
