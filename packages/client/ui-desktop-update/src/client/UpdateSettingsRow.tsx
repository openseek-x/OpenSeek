/** Desktop update policy and status row in the General Settings section. */

import { useState } from 'react'
import {
  Button,
  IconChevronDownOutline14,
  IconRefreshOutline16,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_DESKTOP_UPDATE_POLICY,
  DESKTOP_UPDATE_POLICIES,
  type DesktopUpdatePolicy,
  type DesktopUpdateSettings,
} from '../update-settings.ts'
import type { DesktopUpdateClientState } from './controller.ts'
import type { DesktopUpdateKey } from './locales.ts'
import { updatePrimaryAction, updateStatusText, type UpdatePrimaryAction } from './presentation.ts'
import css from './UpdateSettingsRow.module.css'

/** Registration-side data and actions for the Settings row. */
export interface UpdateSettingsRowInjected {
  hooks: {
    /** Main-process updater state bound as useUpdate. */
    update: { getSnapshot(): DesktopUpdateClientState; subscribe(listener: () => void): () => void }
    /** Host settings scope bound as useUpdatePolicy. */
    updatePolicy: {
      getSnapshot(): SettingsScopeSnapshot<DesktopUpdateSettings>
      subscribe(listener: () => void): () => void
    }
  }
  /** Persist one explicit check policy. */
  setPolicy: (policy: DesktopUpdatePolicy) => void
  /** Run a manual release check. */
  check: () => void
  /** Download the selected update. */
  download: () => void
  /** Restart through the Host shutdown coordinator and install. */
  install: () => void
  /** Open the trusted release page. */
  openReleasePage: () => void
}

/** Full Settings-row props. */
export type UpdateSettingsRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'desktop.update'>
  & InjectFace<UpdateSettingsRowInjected>

const POLICY_KEYS: Record<DesktopUpdatePolicy, DesktopUpdateKey> = {
  background: 'policy.background',
  startup: 'policy.startup',
  manual: 'policy.manual',
  disabled: 'policy.disabled',
}

/**
 * Render the desktop update settings row.
 * @param props - composed slot props.
 * @returns the preference row.
 */
export function UpdateSettingsRow({
  t,
  useUpdate,
  useUpdatePolicy,
  setPolicy,
  check,
  download,
  install,
  openReleasePage,
}: UpdateSettingsRowProps) {
  const update = useUpdate(value => value)
  const policyState = useUpdatePolicy(value => value)
  const policy = policyState.value === undefined
    ? DEFAULT_DESKTOP_UPDATE_POLICY
    : policyState.value.policy
  const [open, setOpen] = useState(false)
  const primary = updatePrimaryAction(update)
  const currentVersion = 'currentVersion' in update ? update.currentVersion : undefined

  const primaryHandlers: Record<Exclude<UpdatePrimaryAction, undefined>, () => void> = {
    check,
    download,
    install,
    'open-release': openReleasePage,
  }
  const runPrimary = primary === undefined ? undefined : primaryHandlers[primary]
  const primaryLabel = primary === 'download'
    ? t('action.download')
    : primary === 'install'
      ? t('action.restart')
      : primary === 'open-release'
        ? t('action.releases')
        : t('action.check')

  return (
    <div className={css.row}>
      <div className={css.copy}>
        <div className={css.title}>{t('row.title')}</div>
        <div className={css.description}>{t('row.description')}</div>
        <div className={css.status} aria-live="polite">
          {updateStatusText(update, t)}
          {currentVersion === undefined ? null : <span>{t('version.current', { version: currentVersion })}</span>}
        </div>
      </div>
      <div className={css.controls}>
        <Menu
          open={open}
          onClose={() => { setOpen(false) }}
          items={DESKTOP_UPDATE_POLICIES.map(id => ({ id, label: t(POLICY_KEYS[id]) }))}
          selectedId={policy}
          onSelect={(id) => {
            setOpen(false)
            setPolicy(id as DesktopUpdatePolicy)
          }}
          align="end"
          portal
          anchor={(
            <button
              type="button"
              className={css.selector}
              aria-haspopup="menu"
              aria-expanded={open}
              disabled={!policyState.writable}
              onClick={() => { setOpen(value => !value) }}
            >
              {t(POLICY_KEYS[policy])}
              <IconChevronDownOutline14 className={css.chevron} />
            </button>
          )}
        />
        <Button
          variant="outline"
          size="sm"
          icon={primary === 'check' ? <IconRefreshOutline16 /> : undefined}
          disabled={primary === undefined}
          onClick={runPrimary}
        >
          {primaryLabel}
        </Button>
      </div>
    </div>
  )
}
