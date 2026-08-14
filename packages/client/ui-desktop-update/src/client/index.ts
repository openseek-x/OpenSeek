/** Desktop update renderer plugin: Settings row and frame overlay over Electron IPC. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DesktopUpdateBridge } from '../protocol.ts'
import {
  DESKTOP_UPDATE_POLICY_FIELD,
  DESKTOP_UPDATE_SETTINGS_NAMESPACE,
  type DesktopUpdatePolicy,
  type DesktopUpdateSettings,
} from '../update-settings.ts'
import { DesktopUpdateClientController } from './controller.ts'
import { en, zh, type DesktopUpdateKey } from './locales.ts'
import { UpdateSettingsRow, type UpdateSettingsRowInjected } from './UpdateSettingsRow.tsx'
import { UpdateToast, type UpdateToastInjected } from './UpdateToast.tsx'

export type { DesktopUpdateClientState } from './controller.ts'
export type { DesktopUpdateKey } from './locales.ts'
export type { UpdateSettingsRowInjected, UpdateSettingsRowProps } from './UpdateSettingsRow.tsx'
export type { UpdateToastInjected, UpdateToastProps } from './UpdateToast.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop update Settings and overlay copy. */
    'desktop.update': DesktopUpdateKey
  }
}

const LOCALE_NAMESPACE = 'desktop.update'

function bridgeFromGlobal(): DesktopUpdateBridge {
  const candidate = (globalThis as typeof globalThis & { dshDesktopUpdate?: DesktopUpdateBridge }).dshDesktopUpdate
  if (candidate === undefined) throw new Error('desktop update bridge is unavailable')
  return candidate
}

/** Required services for slots, dictionaries, and the Host-backed settings scope. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/**
 * Register the Desktop-only update Settings row and frame overlay.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new DesktopUpdateClientController(bridgeFromGlobal())
  const settings = ctx.settingsScope.bind<DesktopUpdateSettings>({
    namespace: DESKTOP_UPDATE_SETTINGS_NAMESPACE,
  })

  ctx.effect(() => controller.start(), 'ui-desktop-update: Electron bridge')
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }), 'ui-desktop-update: dictionaries')

  const actions = {
    check: () => { controller.check() },
    download: () => { controller.download() },
    install: () => { controller.install() },
    openReleasePage: () => { controller.openReleasePage() },
  }
  const settingsInjected = (): UpdateSettingsRowInjected => ({
    hooks: { update: controller, updatePolicy: settings },
    setPolicy: (policy: DesktopUpdatePolicy) => {
      void settings.set(DESKTOP_UPDATE_POLICY_FIELD, policy)
    },
    ...actions,
  })
  const toastInjected = (): UpdateToastInjected => ({
    hooks: { update: controller },
    check: actions.check,
    download: actions.download,
    install: actions.install,
  })

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-update',
    order: 30,
    locale: LOCALE_NAMESPACE,
    inject: settingsInjected,
  }, UpdateSettingsRow))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'desktop-update',
    order: 10,
    locale: LOCALE_NAMESPACE,
    inject: toastInjected,
  }, UpdateToast))
}
