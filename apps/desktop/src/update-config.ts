/** Validation for the build-pinned desktop update runtime configuration. */

/** Build-pinned desktop update settings copied into the packaged application. */
export interface DesktopUpdateRuntimeConfig {
  /** Configuration file format version. */
  version: 1
  /** Whether this build may contact its update provider. */
  enabled: boolean
  /** GitHub organization or user owning the release repository. */
  owner: string
  /** GitHub repository containing desktop releases. */
  repository: string
  /** electron-updater channel selected for this platform and architecture. */
  channel: string
  /** Delay before the first automatic check. */
  startupDelayMs: number
  /** Delay between background checks. */
  intervalMs: number
  /** Duration of a transient manual no-update notice. */
  noticeDurationMs: number
  /** Maximum wait for the native installer to acknowledge update-driven quit. */
  installHandoffTimeoutMs: number
}

/** Mutable electron-updater fields that enforce the stable, consent-first policy. */
export interface DesktopUpdaterConfigurationTarget {
  /** Selected update metadata channel. */
  channel: string | null
  /** Whether an older version may replace the running application. */
  allowDowngrade: boolean
  /** Whether prerelease versions may be selected. */
  allowPrerelease: boolean
  /** Whether discovery starts a download without user consent. */
  autoDownload: boolean
  /** Whether ordinary application quit installs a downloaded update. */
  autoInstallOnAppQuit: boolean
}

/** Development and unsigned-package defaults; network update checks stay off. */
export const DEFAULT_DESKTOP_UPDATE_RUNTIME_CONFIG: Readonly<DesktopUpdateRuntimeConfig> = Object.freeze({
  version: 1,
  enabled: false,
  owner: 'openseek-x',
  repository: 'OpenSeek',
  channel: 'latest',
  startupDelayMs: 30_000,
  intervalMs: 4 * 60 * 60 * 1_000,
  noticeDurationMs: 5_000,
  installHandoffTimeoutMs: 120_000,
})

const CONFIG_KEYS = [
  'version',
  'enabled',
  'owner',
  'repository',
  'channel',
  'startupDelayMs',
  'intervalMs',
  'noticeDurationMs',
  'installHandoffTimeoutMs',
] as const
const SAFE_REPOSITORY_SEGMENT = /^[A-Za-z0-9_.-]+$/
const SAFE_CHANNEL = /^[A-Za-z0-9._-]+$/

/**
 * Apply update policy after selecting the channel because electron-updater's
 * channel setter enables downgrade selection as a side effect.
 * @param target - electron-updater instance or a compatible test target.
 * @param channel - build-pinned stable metadata channel.
 */
export function configureDesktopUpdater(
  target: DesktopUpdaterConfigurationTarget,
  channel: string,
): void {
  target.channel = channel
  target.allowDowngrade = false
  target.allowPrerelease = false
  target.autoDownload = false
  target.autoInstallOnAppQuit = false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedDelay(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
}

function isSafeToken(value: unknown, pattern: RegExp, maximum: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && value !== '.'
    && value !== '..'
    && pattern.test(value)
}

/**
 * Validate the packaged JSON file before it can configure network update checks.
 * @param value - parsed JSON from desktop-update.json.
 * @returns the exact supported runtime configuration.
 */
export function parseDesktopUpdateRuntimeConfig(value: unknown): DesktopUpdateRuntimeConfig {
  if (!isRecord(value)
    || Object.keys(value).length !== CONFIG_KEYS.length
    || !CONFIG_KEYS.every(key => Object.hasOwn(value, key))
    || value.version !== 1
    || typeof value.enabled !== 'boolean'
    || !isSafeToken(value.owner, SAFE_REPOSITORY_SEGMENT, 100)
    || !isSafeToken(value.repository, SAFE_REPOSITORY_SEGMENT, 100)
    || !isSafeToken(value.channel, SAFE_CHANNEL, 64)
    || !isBoundedDelay(value.startupDelayMs, 1_000, 30 * 60 * 1_000)
    || !isBoundedDelay(value.intervalMs, 15 * 60 * 1_000, 7 * 24 * 60 * 60 * 1_000)
    || !isBoundedDelay(value.noticeDurationMs, 1_000, 60_000)
    || !isBoundedDelay(value.installHandoffTimeoutMs, 10_000, 10 * 60 * 1_000)) {
    throw new TypeError('desktop-update.json is invalid')
  }
  return value as unknown as DesktopUpdateRuntimeConfig
}
