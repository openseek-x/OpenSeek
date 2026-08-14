// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { DesktopUpdateClientState } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'
import {
  UpdateSettingsRow,
  type UpdateSettingsRowProps,
} from '../src/client/UpdateSettingsRow.tsx'
import {
  UpdateToast,
  type UpdateToastProps,
} from '../src/client/UpdateToast.tsx'
import type { DesktopUpdateSettings } from '../src/update-settings.ts'
import { updateState } from './helpers.client.ts'

afterEach(cleanup)

const t = makeTranslate(en)

function settingsSnapshot(
  value: DesktopUpdateSettings | undefined,
  writable = true,
): SettingsScopeSnapshot<DesktopUpdateSettings> {
  return {
    status: value === undefined ? 'loading' : 'ready',
    value,
    base: undefined,
    user: undefined,
    revision: value === undefined ? undefined : 1,
    writable,
    mode: 'host',
  }
}

function rowProps(
  update: DesktopUpdateClientState,
  policy = settingsSnapshot({ policy: 'background' }),
) {
  return {
    useSessions: (() => undefined) as never,
    useWorkspaces: (() => undefined) as never,
    useUpdate: selector => selector(update),
    useUpdatePolicy: selector => selector(policy),
    t,
    setPolicy: vi.fn(),
    check: vi.fn(),
    download: vi.fn(),
    install: vi.fn(),
    openReleasePage: vi.fn(),
  } satisfies UpdateSettingsRowProps
}

function toastProps(update: DesktopUpdateClientState) {
  return {
    useSessions: (() => undefined) as never,
    useWorkspaces: (() => undefined) as never,
    useUpdate: selector => selector(update),
    t,
    check: vi.fn(),
    download: vi.fn(),
    install: vi.fn(),
  } satisfies UpdateToastProps
}

describe('UpdateSettingsRow', () => {
  it('renders status, current version, and persists an explicit policy choice', () => {
    const props = rowProps(updateState({ status: 'idle' }))
    render(<UpdateSettingsRow {...props} />)
    expect(screen.getByText('Automatic updates')).toBeTruthy()
    expect(screen.getByText('Waiting for the next check')).toBeTruthy()
    expect(screen.getByText('Current version: 1.0.0')).toBeTruthy()

    const selector = screen.getByRole('button', { name: 'Check periodically' })
    fireEvent.click(selector)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manual checks only' }))
    expect(props.setPolicy).toHaveBeenCalledWith('manual')
  })

  it('closes the policy menu on Escape and disables it while settings are read-only', () => {
    const props = rowProps(updateState({ status: 'idle' }))
    const view = render(<UpdateSettingsRow {...props} />)
    const selector = screen.getByRole('button', { name: 'Check periodically' })
    fireEvent.click(selector)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    view.rerender(<UpdateSettingsRow {...rowProps({ status: 'loading' }, settingsSnapshot(undefined, false))} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Check periodically' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Check for updates' }).disabled).toBe(true)
    expect(screen.queryByText(/Current version:/)).toBeNull()
  })

  it('routes each valid primary action', () => {
    const cases = [
      [updateState({ status: 'idle' }), 'Check for updates', 'check'],
      [updateState({ status: 'available', updateVersion: '1.2.0' }), 'Download update', 'download'],
      [updateState({ status: 'ready', updateVersion: '1.2.0' }), 'Restart and install', 'install'],
      [updateState({ status: 'disabled', reason: 'development' }), 'View releases', 'openReleasePage'],
    ] as const

    for (const [state, label, action] of cases) {
      const props = rowProps(state)
      const view = render(<UpdateSettingsRow {...props} />)
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(props[action]).toHaveBeenCalledOnce()
      view.unmount()
    }
  })
})

describe('UpdateToast', () => {
  it('offers download and keeps the same available version dismissed', () => {
    const first = toastProps(updateState({ status: 'available', updateVersion: '1.2.0' }))
    const view = render(<UpdateToast {...first} />)
    expect(screen.getByRole('status').textContent).toContain('DeepSeek Harness 1.2.0 is available')
    expect(screen.queryByText('Version 1.2.0 is available')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Download update' }))
    expect(first.download).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update notice' }))
    expect(screen.queryByRole('status')).toBeNull()
    view.rerender(<UpdateToast {...toastProps(updateState(
      { status: 'available', updateVersion: '1.2.0' },
      { revision: 2 },
    ))} />)
    expect(screen.queryByRole('status')).toBeNull()
    view.rerender(<UpdateToast {...toastProps(updateState(
      { status: 'available', updateVersion: '1.3.0' },
      { revision: 3 },
    ))} />)
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('offers restart for a ready update and shows download progress without an action', () => {
    const ready = toastProps(updateState({ status: 'ready', updateVersion: '1.2.0' }))
    const view = render(<UpdateToast {...ready} />)
    expect(screen.getByText('Version 1.2.0 is downloaded and will install after restart')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restart and install' }))
    expect(ready.install).toHaveBeenCalledOnce()

    view.rerender(<UpdateToast {...toastProps(updateState({
      status: 'downloading',
      updateVersion: '1.2.0',
      progress: { percent: 25, transferred: 25, total: 100, bytesPerSecond: 10 },
    }, { revision: 2 }))} />)
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('25')
    expect(screen.queryByRole('button', { name: /Download|Restart|Check/ })).toBeNull()
  })

  it('keeps a dismissed download hidden across progress revisions and reappears when ready', () => {
    const downloading = (revision: number, percent: number) => toastProps(updateState({
      status: 'downloading',
      updateVersion: '1.2.0',
      progress: { percent, transferred: percent, total: 100, bytesPerSecond: 10 },
    }, { revision }))
    const view = render(<UpdateToast {...downloading(1, 10)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update notice' }))
    expect(screen.queryByRole('status')).toBeNull()

    view.rerender(<UpdateToast {...downloading(2, 20)} />)
    expect(screen.queryByRole('status')).toBeNull()

    view.rerender(<UpdateToast {...toastProps(updateState(
      { status: 'ready', updateVersion: '1.2.0' },
      { revision: 3 },
    ))} />)
    expect(screen.getByRole('status').textContent).toContain('Update ready')
  })

  it('makes manual and bridge errors retryable alerts', () => {
    const error = toastProps(updateState({ status: 'error', message: 'offline', manual: true }))
    const view = render(<UpdateToast {...error} />)
    expect(screen.getByRole('alert').textContent).toContain('Update check failed: offline')
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(error.check).toHaveBeenCalledOnce()

    const bridge = toastProps({ status: 'bridge-error', message: 'IPC closed' })
    view.rerender(<UpdateToast {...bridge} />)
    expect(screen.getByRole('alert').textContent).toContain('Update check failed: IPC closed')
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(bridge.check).toHaveBeenCalledOnce()
  })

  it('shows manual checking and no-update notices but suppresses background states', () => {
    const view = render(<UpdateToast {...toastProps(updateState({ status: 'checking', manual: true }))} />)
    expect(screen.getByRole('status').textContent).toContain('Checking for updates…')

    view.rerender(<UpdateToast {...toastProps(updateState(
      { status: 'idle', notice: 'up-to-date' },
      { revision: 2 },
    ))} />)
    expect(screen.getByRole('status').textContent).toContain('DeepSeek Harness is up to date')

    const hidden: DesktopUpdateClientState[] = [
      { status: 'loading' },
      updateState({ status: 'disabled', reason: 'policy' }, { revision: 3 }),
      updateState({ status: 'idle' }, { revision: 4 }),
      updateState({ status: 'checking', manual: false }, { revision: 5 }),
      updateState({ status: 'error', message: 'offline', manual: false }, { revision: 6 }),
    ]
    for (const state of hidden) {
      view.rerender(<UpdateToast {...toastProps(state)} />)
      expect(screen.queryByRole('status')).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    }
  })
})
