/** Electron adapter and signed release configuration for desktop updates. */

import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { app, autoUpdater as nativeAutoUpdater, shell } from 'electron'
import electronUpdater, { type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { DesktopUpdateDisabledReason } from '@deepseek-ai/dsh-client-connection/desktop-update'
import {
  DesktopUpdateController,
  type DesktopReleaseInfo,
  type DesktopUpdateBackend,
  type DesktopUpdatePreferences,
  type DesktopUpdateScheduler,
} from './update-controller.ts'
import {
  configureDesktopUpdater,
  DEFAULT_DESKTOP_UPDATE_RUNTIME_CONFIG,
  parseDesktopUpdateRuntimeConfig,
  type DesktopUpdateRuntimeConfig,
} from './update-config.ts'
import { waitForDesktopInstallerHandoff } from './installer-handoff.ts'

const { autoUpdater } = electronUpdater

async function loadRuntimeConfig(): Promise<DesktopUpdateRuntimeConfig> {
  if (!app.isPackaged) return DEFAULT_DESKTOP_UPDATE_RUNTIME_CONFIG
  const path = resolve(process.resourcesPath, 'desktop-update.json')
  return parseDesktopUpdateRuntimeConfig(JSON.parse(await readFile(path, 'utf8')) as unknown)
}

function releaseInfo(info: UpdateInfo): DesktopReleaseInfo {
  return {
    version: info.version,
    releaseDate: info.releaseDate,
  }
}

function electronBackend(channel: string, installHandoffTimeoutMs: number): DesktopUpdateBackend {
  configureDesktopUpdater(autoUpdater, channel)
  autoUpdater.logger = console

  return {
    onAvailable(listener) {
      const handler = (info: UpdateInfo): void => { listener(releaseInfo(info)) }
      autoUpdater.on('update-available', handler)
      return () => { autoUpdater.off('update-available', handler) }
    },
    onNotAvailable(listener) {
      const handler = (): void => { listener() }
      autoUpdater.on('update-not-available', handler)
      return () => { autoUpdater.off('update-not-available', handler) }
    },
    onProgress(listener) {
      const handler = (progress: ProgressInfo): void => {
        listener({
          percent: progress.percent,
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond,
        })
      }
      autoUpdater.on('download-progress', handler)
      return () => { autoUpdater.off('download-progress', handler) }
    },
    onDownloaded(listener) {
      const handler = (info: UpdateInfo): void => { listener(releaseInfo(info)) }
      autoUpdater.on('update-downloaded', handler)
      return () => { autoUpdater.off('update-downloaded', handler) }
    },
    onError(listener) {
      const handler = (error: Error): void => { listener(error) }
      autoUpdater.on('error', handler)
      return () => { autoUpdater.off('error', handler) }
    },
    async checkForUpdates() {
      await autoUpdater.checkForUpdates()
    },
    async downloadUpdate() {
      await autoUpdater.downloadUpdate()
    },
    async quitAndInstall(acknowledge) {
      await waitForDesktopInstallerHandoff({
        onBeforeQuit(listener) {
          nativeAutoUpdater.on('before-quit-for-update', listener)
          return () => { nativeAutoUpdater.off('before-quit-for-update', listener) }
        },
        onError(listener) {
          autoUpdater.on('error', listener)
          return () => { autoUpdater.off('error', listener) }
        },
        invoke() {
          autoUpdater.quitAndInstall(false, true)
        },
      }, installHandoffTimeoutMs, acknowledge)
    },
  }
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

function isInstalledMacApplication(): boolean {
  if (process.platform !== 'darwin') return true
  const executable = app.getPath('exe')
  return inside('/Applications', executable)
    || inside(resolve(app.getPath('home'), 'Applications'), executable)
}

function disabledReason(config: DesktopUpdateRuntimeConfig): Exclude<DesktopUpdateDisabledReason, 'policy'> | undefined {
  if (!app.isPackaged) return 'development'
  if (process.platform !== 'darwin' && process.platform !== 'win32') return 'unsupported-platform'
  if (!config.enabled) return 'updates-not-enabled'
  if (!isInstalledMacApplication()) return 'not-installed'
  return undefined
}

const scheduler: DesktopUpdateScheduler = {
  set(callback, delayMs) {
    return setTimeout(callback, delayMs)
  },
  clear(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

/**
 * Create the main-process updater from build-pinned config and generic Host settings.
 * @param preferences - adapter that reads and observes the desktop update namespace.
 * @param requestInstall - clean-shutdown callback owned by the Electron main process.
 * @returns configured, not-yet-started updater controller.
 */
export async function createDesktopUpdater(
  preferences: DesktopUpdatePreferences,
  requestInstall: () => Promise<void>,
): Promise<DesktopUpdateController> {
  const config = await loadRuntimeConfig()
  const releaseUrl = `https://github.com/${config.owner}/${config.repository}/releases/latest`
  const reason = disabledReason(config)
  return new DesktopUpdateController({
    currentVersion: app.getVersion(),
    releaseUrl,
    ...(reason === undefined ? {} : { disabledReason: reason }),
    startupDelayMs: config.startupDelayMs,
    intervalMs: config.intervalMs,
    noticeDurationMs: config.noticeDurationMs,
    preferences,
    backend: electronBackend(config.channel, config.installHandoffTimeoutMs),
    scheduler,
    now: () => new Date(),
    requestInstall,
    openReleasePage: async () => {
      await shell.openExternal(releaseUrl)
    },
  })
}
