/** Browser-safe structured-clone protocol for the Electron desktop update bridge. */

/** Update-check policies accepted at the settings and Electron boundaries. */
export const DESKTOP_UPDATE_POLICIES = ['background', 'startup', 'manual', 'disabled'] as const

/** Settings namespace carrying the desktop update policy. */
export const DESKTOP_UPDATE_SETTINGS_NAMESPACE = 'desktop-update'

/** Reasons the packaged application cannot run its updater. */
export const DESKTOP_UPDATE_DISABLED_REASONS = [
  'development',
  'updates-not-enabled',
  'unsupported-platform',
  'not-installed',
  'policy',
] as const

/** One updater action accepted from the isolated renderer. */
export const DESKTOP_UPDATE_ACTIONS = ['check', 'download', 'install', 'open-release'] as const

/** Persisted update-check policy. */
export type DesktopUpdatePolicy = typeof DESKTOP_UPDATE_POLICIES[number]

/** Reason the updater is unavailable. */
export type DesktopUpdateDisabledReason = typeof DESKTOP_UPDATE_DISABLED_REASONS[number]

/** Renderer-to-main updater action. */
export type DesktopUpdateAction = typeof DESKTOP_UPDATE_ACTIONS[number]

/** Download progress published by electron-updater. */
export interface DesktopUpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

/** Fields carried by every main-process updater state. */
export interface DesktopUpdateStateBase {
  revision: number
  currentVersion: string
  policy: DesktopUpdatePolicy
  releaseUrl: string
  checkedAt?: string
}

/** Immutable updater state published by the main process. */
export type DesktopUpdateState =
  | DesktopUpdateStateBase & { status: 'disabled'; reason: DesktopUpdateDisabledReason }
  | DesktopUpdateStateBase & { status: 'idle'; notice?: 'up-to-date' }
  | DesktopUpdateStateBase & { status: 'checking'; manual: boolean }
  | DesktopUpdateStateBase & { status: 'available'; updateVersion: string; releaseDate?: string }
  | DesktopUpdateStateBase & { status: 'downloading'; updateVersion: string; progress: DesktopUpdateProgress }
  | DesktopUpdateStateBase & { status: 'ready'; updateVersion: string }
  | DesktopUpdateStateBase & { status: 'error'; message: string; manual: boolean }

/** Context-isolated bridge exposed by the Electron preload. */
export interface DesktopUpdateBridge {
  getState(): Promise<DesktopUpdateState>
  act(action: DesktopUpdateAction): Promise<DesktopUpdateState>
  onState(listener: (state: DesktopUpdateState) => void): () => void
}

/** @returns whether the candidate is one supported durable check policy. */
export function isDesktopUpdatePolicy(value: unknown): value is DesktopUpdatePolicy {
  return DESKTOP_UPDATE_POLICIES.some(policy => policy === value)
}

/** @returns whether the candidate is one supported updater action. */
export function isDesktopUpdateAction(value: unknown): value is DesktopUpdateAction {
  return DESKTOP_UPDATE_ACTIONS.some(action => action === value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

function isOptionalIsoDate(value: unknown): value is string | undefined {
  if (value === undefined) return true
  if (!isNonEmptyString(value)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false
  const timestamp = Date.parse(value)
  const normalized = value.includes('.') ? value : `${value.slice(0, -1)}.000Z`
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === normalized
}

function isTrustedReleaseUrl(value: unknown): value is string {
  if (!isNonEmptyString(value, 512)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases(?:\/latest)?\/?$/.test(url.pathname)
      && url.search === ''
      && url.hash === ''
  } catch {
    return false
  }
}

function hasBase(value: Record<string, unknown>): boolean {
  return Number.isSafeInteger(value.revision)
    && (value.revision as number) >= 0
    && isNonEmptyString(value.currentVersion)
    && isDesktopUpdatePolicy(value.policy)
    && isTrustedReleaseUrl(value.releaseUrl)
    && isOptionalIsoDate(value.checkedAt)
}

function isProgress(value: unknown): value is DesktopUpdateProgress {
  if (!isRecord(value)) return false
  const numbers = [value.percent, value.transferred, value.total, value.bytesPerSecond]
  return numbers.every(entry => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0)
    && (value.percent as number) <= 100
    && (value.transferred as number) <= (value.total as number)
}

/**
 * Validate one main-to-renderer updater state at the process boundary.
 * @param value - structured-clone value returned or emitted by Electron IPC.
 * @returns the narrowed updater state.
 */
export function parseDesktopUpdateState(value: unknown): DesktopUpdateState {
  if (!isRecord(value) || !hasBase(value) || typeof value.status !== 'string') {
    throw new TypeError('desktop update state is invalid')
  }
  switch (value.status) {
    case 'disabled':
      if (!DESKTOP_UPDATE_DISABLED_REASONS.some(reason => reason === value.reason)) break
      return value as unknown as DesktopUpdateState
    case 'idle':
      if (value.notice !== undefined && value.notice !== 'up-to-date') break
      return value as unknown as DesktopUpdateState
    case 'checking':
      if (typeof value.manual !== 'boolean') break
      return value as unknown as DesktopUpdateState
    case 'available':
      if (!isNonEmptyString(value.updateVersion) || !isOptionalIsoDate(value.releaseDate)) break
      return value as unknown as DesktopUpdateState
    case 'downloading':
      if (!isNonEmptyString(value.updateVersion) || !isProgress(value.progress)) break
      return value as unknown as DesktopUpdateState
    case 'ready':
      if (!isNonEmptyString(value.updateVersion)) break
      return value as unknown as DesktopUpdateState
    case 'error':
      if (!isNonEmptyString(value.message, 2_048) || typeof value.manual !== 'boolean') break
      return value as unknown as DesktopUpdateState
  }
  throw new TypeError(`desktop update state ${JSON.stringify(value.status)} is invalid`)
}
