/** Write and verify the updater configuration sealed into a macOS application. */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dump, load } from 'js-yaml'

const CONFIG_FILENAME = 'app-update.yml'
const CHANNEL = 'nightly'

function object(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`desktop macOS update config: ${label} must be an object`)
  }
  return value
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`desktop macOS update config: ${label} must be a non-empty string`)
  }
  return value
}

/**
 * Resolve the signed Nightly or version-bound OpenSeek feed from electron-builder configuration.
 * @param {unknown} publish - Final electron-builder publish setting.
 * @returns {import('./macos-app-update-config.d.mts').MacOSAppUpdateFeed} Resolved feed used by the packaged App.
 */
export function resolveMacOSAppUpdateFeed(publish) {
  if (!Array.isArray(publish) || publish.length !== 1) {
    throw new Error('desktop macOS update config: publish must contain exactly one provider')
  }
  const provider = object(publish[0], 'publish provider')
  if (provider.provider === 'generic' && provider.channel === CHANNEL) {
    return { publicUrl: nonEmptyString(provider.url, 'publish provider URL') }
  }
  if (provider.provider === 'github' && provider.owner === 'openseek-x' && provider.repo === 'OpenSeek'
    && /^latest-(?:arm64|x64)$/u.test(provider.channel)) {
    return { provider: 'github', owner: provider.owner, repo: provider.repo, channel: provider.channel }
  }
  throw new Error('desktop macOS update config: publish provider must be generic Nightly or OpenSeek GitHub')
}

/**
 * Create the electron-updater configuration embedded before code signing.
 * @param {import('./macos-app-update-config.d.mts').MacOSAppUpdateFeed} update - Resolved update feed.
 * @param {string} updaterCacheDirName - electron-builder application cache directory.
 * @returns {import('./macos-app-update-config.d.mts').MacOSAppUpdateConfig} Packaged updater fields.
 */
export function createMacOSAppUpdateConfig(update, updaterCacheDirName) {
  const cache = nonEmptyString(updaterCacheDirName, 'updater cache directory')
  return 'publicUrl' in update
    ? { provider: 'generic', url: nonEmptyString(update.publicUrl, 'public URL'), channel: CHANNEL, updaterCacheDirName: cache }
    : { ...update, updaterCacheDirName: cache }
}

/**
 * Write the updater configuration into an assembled App before signing.
 * @param {string} resourcesDir - App Contents/Resources directory.
 * @param {import('./macos-app-update-config.d.mts').MacOSAppUpdateFeed} update - Resolved update feed.
 * @param {string} updaterCacheDirName - electron-builder application cache directory.
 * @returns {Promise<void>} Resolves after the configuration is durable.
 */
export async function writeMacOSAppUpdateConfig(resourcesDir, update, updaterCacheDirName) {
  const config = createMacOSAppUpdateConfig(update, updaterCacheDirName)
  await writeFile(join(resourcesDir, CONFIG_FILENAME), dump(config, { lineWidth: -1, noRefs: true }))
}

/**
 * Verify the updater configuration inside an assembled macOS App.
 * @param {string} appPath - Application bundle path.
 * @param {{ publicUrl: string }} update - Expected update feed.
 * @param {string | undefined} updaterCacheDirName - Exact cache directory when known.
 * @returns {Promise<void>} Resolves when the packaged configuration matches the release destination.
 */
export async function verifyMacOSAppUpdateConfig(appPath, update, updaterCacheDirName = undefined) {
  const path = join(appPath, 'Contents', 'Resources', CONFIG_FILENAME)
  let parsed
  try {
    parsed = load(await readFile(path, 'utf8'))
  }
  catch (error) {
    throw new Error(`desktop macOS update config: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const config = object(parsed, CONFIG_FILENAME)
  const actualCacheDirName = nonEmptyString(config.updaterCacheDirName, `${CONFIG_FILENAME}.updaterCacheDirName`)
  const expected = createMacOSAppUpdateConfig(update, actualCacheDirName)
  if (Object.entries(expected).some(([field, value]) => config[field] !== value)) {
    throw new Error(`desktop macOS update config: ${path} does not match the selected release feed`)
  }
  if (updaterCacheDirName !== undefined && actualCacheDirName !== updaterCacheDirName) {
    throw new Error(`desktop macOS update config: ${path} has updater cache directory ${actualCacheDirName}; expected ${updaterCacheDirName}`)
  }
}
