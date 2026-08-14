/** Pure update-state presentation decisions shared by the two desktop surfaces. */

import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopUpdateKey } from './locales.ts'
import type { DesktopUpdateClientState } from './controller.ts'

/** Action exposed by the Settings row for one updater state. */
export type UpdatePrimaryAction = 'check' | 'download' | 'install' | 'open-release' | undefined

function roundedPercent(state: Extract<DesktopUpdateClientState, { status: 'downloading' }>): number {
  return Math.round(state.progress.percent)
}

/** Closed-union exhaustiveness fence for renderer-local updater states. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a state is forged */
function assertNever(value: never): never {
  throw new Error(`unexpected desktop update state: ${JSON.stringify(value)}`)
}

/**
 * Resolve the status sentence for a renderer-local updater state.
 * @param state - current client updater state.
 * @param t - bound desktop.update translator.
 * @returns localized status sentence.
 */
export function updateStatusText(
  state: DesktopUpdateClientState,
  t: Translate<DesktopUpdateKey>,
): string {
  switch (state.status) {
    case 'loading': return t('status.loading')
    case 'bridge-error': return t('status.error', { message: state.message })
    case 'disabled': return t(`status.disabled.${state.reason}`)
    case 'idle': return state.notice === 'up-to-date' ? t('status.upToDate') : t('status.idle')
    case 'checking': return t('status.checking')
    case 'available': return t('status.available', { version: state.updateVersion })
    case 'downloading': return t('status.downloading', {
      version: state.updateVersion,
      percent: roundedPercent(state),
    })
    case 'ready': return t('status.ready', { version: state.updateVersion })
    case 'error': return t('status.error', { message: state.message })
    /* v8 ignore next -- closed updater-state union */
    default: return assertNever(state)
  }
}

/**
 * Resolve the Settings row's primary updater action.
 * @param state - current client updater state.
 * @returns action, or undefined while no action is valid.
 */
export function updatePrimaryAction(state: DesktopUpdateClientState): UpdatePrimaryAction {
  switch (state.status) {
    case 'loading':
    case 'checking':
    case 'downloading':
      return undefined
    case 'disabled':
      return state.reason === 'policy' ? undefined : 'open-release'
    case 'available': return 'download'
    case 'ready': return 'install'
    case 'bridge-error':
    case 'idle':
    case 'error':
      return 'check'
    /* v8 ignore next -- closed updater-state union */
    default: return assertNever(state)
  }
}
