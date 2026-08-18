/** Host registration for desktop update preferences. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  DESKTOP_UPDATE_SETTINGS_NAMESPACE,
  DesktopUpdateSettingsSchema,
} from './update-settings.ts'

export {
  DEFAULT_DESKTOP_UPDATE_POLICY,
  DESKTOP_UPDATE_POLICIES,
  DESKTOP_UPDATE_POLICY_FIELD,
  DESKTOP_UPDATE_SETTINGS_NAMESPACE,
  DesktopUpdateSettingsSchema,
  isDesktopUpdatePolicy,
  type DesktopUpdatePolicy,
  type DesktopUpdateSettings,
} from './update-settings.ts'
export {
  DESKTOP_UPDATE_ACTIONS,
  DESKTOP_UPDATE_DISABLED_REASONS,
  isDesktopUpdateAction,
  parseDesktopUpdateState,
  type DesktopUpdateAction,
  type DesktopUpdateBridge,
  type DesktopUpdateDisabledReason,
  type DesktopUpdateProgress,
  type DesktopUpdateState,
  type DesktopUpdateStateBase,
} from './protocol.ts'

const UPDATE_NAMESPACE = settingsNamespace(DESKTOP_UPDATE_SETTINGS_NAMESPACE)

/**
 * Register the desktop update settings namespace.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(UPDATE_NAMESPACE, DesktopUpdateSettingsSchema)
  })
}
