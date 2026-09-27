/** Feed selected by the signed release or version-bound OpenSeek distribution. */
export type MacOSAppUpdateFeed =
  | { readonly publicUrl: string }
  | { readonly provider: 'github', readonly owner: 'openseek-x', readonly repo: 'OpenSeek', readonly channel: string }

/** Packaged electron-updater configuration for macOS. */
export type MacOSAppUpdateConfig =
  | { readonly provider: 'generic', readonly url: string, readonly channel: 'nightly', readonly updaterCacheDirName: string }
  | { readonly provider: 'github', readonly owner: 'openseek-x', readonly repo: 'OpenSeek',
      readonly channel: string, readonly updaterCacheDirName: string }

/** Resolve the signed Nightly or version-bound OpenSeek feed from electron-builder configuration. */
export function resolveMacOSAppUpdateFeed(publish: unknown): MacOSAppUpdateFeed

/** Create the electron-updater configuration embedded before code signing. */
export function createMacOSAppUpdateConfig(
  update: MacOSAppUpdateFeed,
  updaterCacheDirName: string,
): MacOSAppUpdateConfig

/** Write the updater configuration into an assembled App before signing. */
export function writeMacOSAppUpdateConfig(
  resourcesDir: string,
  update: MacOSAppUpdateFeed,
  updaterCacheDirName: string,
): Promise<void>

/** Verify the updater configuration inside an assembled macOS App. */
export function verifyMacOSAppUpdateConfig(
  appPath: string,
  update: MacOSAppUpdateFeed,
  updaterCacheDirName?: string,
): Promise<void>
