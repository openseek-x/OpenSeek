import { describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { DesktopUpdateClientState } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'
import {
  updatePrimaryAction,
  updateStatusText,
} from '../src/client/presentation.ts'
import { updateState } from './helpers.client.ts'

const t = makeTranslate(en) as Parameters<typeof updateStatusText>[1]

describe('desktop update presentation', () => {
  it('renders every state without inventing renderer state', () => {
    const cases: readonly [DesktopUpdateClientState, string][] = [
      [{ status: 'loading' }, 'Connecting to the update service…'],
      [{ status: 'bridge-error', message: 'IPC closed' }, 'Update check failed: IPC closed'],
      [updateState({ status: 'disabled', reason: 'unsupported-platform' }), 'Linux archives do not support in-place updates yet'],
      [updateState({ status: 'idle' }), 'Waiting for the next check'],
      [updateState({ status: 'idle', notice: 'up-to-date' }), 'You have the latest version'],
      [updateState({ status: 'checking', manual: true }), 'Checking for updates…'],
      [updateState({ status: 'available', updateVersion: '1.2.0' }), 'Version 1.2.0 is available'],
      [updateState({
        status: 'downloading',
        updateVersion: '1.2.0',
        progress: { percent: 50.5, transferred: 50, total: 100, bytesPerSecond: 20 },
      }), 'Downloading 1.2.0 (51%)'],
      [updateState({ status: 'ready', updateVersion: '1.2.0' }), 'Version 1.2.0 is downloaded and will install after restart'],
      [updateState({ status: 'error', message: 'offline', manual: false }), 'Update check failed: offline'],
    ]
    for (const [state, expected] of cases) expect(updateStatusText(state, t)).toBe(expected)
  })

  it('selects only actions that are valid for the current state', () => {
    const cases: readonly [DesktopUpdateClientState, ReturnType<typeof updatePrimaryAction>][] = [
      [{ status: 'loading' }, undefined],
      [updateState({ status: 'checking', manual: false }), undefined],
      [updateState({
        status: 'downloading',
        updateVersion: '1.2.0',
        progress: { percent: 50, transferred: 50, total: 100, bytesPerSecond: 20 },
      }), undefined],
      [updateState({ status: 'disabled', reason: 'policy' }), undefined],
      [updateState({ status: 'disabled', reason: 'development' }), 'open-release'],
      [updateState({ status: 'available', updateVersion: '1.2.0' }), 'download'],
      [updateState({ status: 'ready', updateVersion: '1.2.0' }), 'install'],
      [{ status: 'bridge-error', message: 'offline' }, 'check'],
      [updateState({ status: 'idle' }), 'check'],
      [updateState({ status: 'error', message: 'offline', manual: true }), 'check'],
    ]
    for (const [state, expected] of cases) expect(updatePrimaryAction(state)).toBe(expected)
  })
})
