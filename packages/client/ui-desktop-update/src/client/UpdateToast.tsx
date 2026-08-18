/** Non-modal frame overlay for actionable desktop update states. */

import { useState } from 'react'
import {
  Button,
  IconCloseFill14,
  IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the shell.overlay SlotMap declaration into this program.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { DesktopUpdateClientState } from './controller.ts'
import { updateStatusText } from './presentation.ts'
import css from './UpdateToast.module.css'

/** Registration-side data and actions for the overlay. */
export interface UpdateToastInjected {
  hooks: {
    /** Main-process updater state bound as useUpdate. */
    update: { getSnapshot(): DesktopUpdateClientState; subscribe(listener: () => void): () => void }
  }
  /** Run a manual release check. */
  check: () => void
  /** Download the available update. */
  download: () => void
  /** Restart and install the downloaded update. */
  install: () => void
}

/** Full overlay props. */
export type UpdateToastProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'desktop.update'>
  & InjectFace<UpdateToastInjected>

function visible(state: DesktopUpdateClientState): boolean {
  switch (state.status) {
    case 'available':
    case 'downloading':
    case 'ready':
    case 'bridge-error':
      return true
    case 'checking':
    case 'error':
      return state.manual
    case 'idle':
      return state.notice === 'up-to-date'
    case 'loading':
    case 'disabled':
      return false
    /* v8 ignore next -- closed updater-state union */
    default: return assertNever(state)
  }
}

/** Closed-union exhaustiveness fence for overlay visibility. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a state is forged */
function assertNever(value: never): never {
  throw new Error(`unexpected desktop update state: ${JSON.stringify(value)}`)
}

function dismissalKey(state: DesktopUpdateClientState): string {
  switch (state.status) {
    case 'available':
    case 'downloading':
    case 'ready':
      return `${state.status}:${state.updateVersion}`
    case 'bridge-error':
      return `${state.status}:${state.message}`
    case 'loading':
      return state.status
    case 'disabled':
    case 'idle':
    case 'checking':
    case 'error':
      return `${state.status}:${String(state.revision)}`
    /* v8 ignore next -- closed updater-state union */
    default: return assertNever(state)
  }
}

/**
 * Render one dismissible, non-modal updater notice.
 * @param props - composed slot props.
 * @returns the notice or null for background/non-actionable states.
 */
export function UpdateToast({ t, useUpdate, check, download, install }: UpdateToastProps) {
  const update = useUpdate(value => value)
  const revision = dismissalKey(update)
  const [dismissed, setDismissed] = useState<string>()
  if (!visible(update) || dismissed === revision) return null

  const action = update.status === 'available'
    ? { label: t('action.download'), run: download }
    : update.status === 'ready'
      ? { label: t('action.restart'), run: install }
      : update.status === 'error' || update.status === 'bridge-error'
        ? { label: t('action.check'), run: check }
        : undefined
  const title = update.status === 'available'
    ? t('toast.available', { version: update.updateVersion })
    : update.status === 'ready'
      ? t('toast.ready')
      : update.status === 'idle'
        ? t('toast.upToDate')
        : updateStatusText(update, t)

  return (
    <aside className={css.toast} role={update.status === 'error' || update.status === 'bridge-error' ? 'alert' : 'status'}>
      <div className={css.body}>
        <div className={css.title}>{title}</div>
        {update.status === 'ready'
          ? <div className={css.description}>{updateStatusText(update, t)}</div>
          : null}
        {update.status === 'downloading' && (
          <progress
            className={css.progress}
            value={update.progress.percent}
            max={100}
            aria-label={title}
          />
        )}
      </div>
      {action === undefined ? null : (
        <Button
          variant="primary"
          size="sm"
          icon={action.run === check ? <IconRefreshOutline16 /> : undefined}
          onClick={action.run}
        >
          {action.label}
        </Button>
      )}
      <button
        type="button"
        className={css.close}
        aria-label={t('toast.close')}
        onClick={() => { setDismissed(revision) }}
      >
        <IconCloseFill14 />
      </button>
    </aside>
  )
}
