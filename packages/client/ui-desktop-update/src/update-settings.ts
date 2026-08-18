/** Desktop update-check preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'
import {
  DESKTOP_UPDATE_POLICIES,
  type DesktopUpdatePolicy,
} from '@deepseek-ai/dsh-client-connection/desktop-update'

export {
  DESKTOP_UPDATE_POLICIES,
  DESKTOP_UPDATE_SETTINGS_NAMESPACE,
  isDesktopUpdatePolicy,
  type DesktopUpdatePolicy,
} from '@deepseek-ai/dsh-client-connection/desktop-update'

/** Field carrying the selected update-check policy. */
export const DESKTOP_UPDATE_POLICY_FIELD = 'policy'

/** Default policy: check after startup and periodically while the app remains open. */
export const DEFAULT_DESKTOP_UPDATE_POLICY: DesktopUpdatePolicy = 'background'

/** Durable desktop update settings shared by the Host and renderer. */
export interface DesktopUpdateSettings {
  /** Selected update-check policy. */
  policy: DesktopUpdatePolicy
}

/** Durable settings schema; also the wire envelope the renderer validates against. */
export const DesktopUpdateSettingsSchema: z<DesktopUpdateSettings> = z.object({
  [DESKTOP_UPDATE_POLICY_FIELD]: z.union([...DESKTOP_UPDATE_POLICIES]).default(DEFAULT_DESKTOP_UPDATE_POLICY),
})
