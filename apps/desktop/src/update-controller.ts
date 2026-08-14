/** Deterministic desktop updater state machine over an injected release backend. */

import type {
  DesktopUpdateDisabledReason,
  DesktopUpdatePolicy,
  DesktopUpdateProgress,
  DesktopUpdateState,
} from '@deepseek-ai/dsh-client-connection/desktop-update'

/** Read-only update policy face adapted from the generic Host settings service. */
export interface DesktopUpdatePreferences {
  /** @returns the currently resolved update-check policy. */
  getPolicy(): DesktopUpdatePolicy
  /**
   * Observe durable policy changes.
   * @param listener - callback receiving the next policy.
   * @returns disposer removing the observer.
   */
  subscribe(listener: (policy: DesktopUpdatePolicy) => void): () => void
}

/** Release metadata consumed by state transitions. */
export interface DesktopReleaseInfo {
  /** SemVer version reported by the update provider. */
  version: string
  /** Provider release timestamp, when supplied. */
  releaseDate?: string
}

/** Event and action face adapted from electron-updater. */
export interface DesktopUpdateBackend {
  /** Observe an available release. */
  onAvailable(listener: (info: DesktopReleaseInfo) => void): () => void
  /** Observe a completed check with no newer release. */
  onNotAvailable(listener: () => void): () => void
  /** Observe update transfer progress. */
  onProgress(listener: (progress: DesktopUpdateProgress) => void): () => void
  /** Observe a verified, downloaded update. */
  onDownloaded(listener: (info: DesktopReleaseInfo) => void): () => void
  /** Observe provider or transfer failures. */
  onError(listener: (error: Error) => void): () => void
  /** Run one metadata check. */
  checkForUpdates(): Promise<void>
  /** Download the release selected by the last check. */
  downloadUpdate(): Promise<void>
  /**
   * Hand control to the platform installer after Host quiescence.
   * @param acknowledge - synchronously transfer native quit ownership.
   */
  quitAndInstall(acknowledge: () => void): Promise<void>
}

/** Replaceable timeout face for deterministic tests. */
export interface DesktopUpdateScheduler {
  /** Schedule one callback. */
  set(callback: () => void, delayMs: number): unknown
  /** Cancel one scheduled callback. */
  clear(handle: unknown): void
}

/** Construction options for {@link DesktopUpdateController}. */
export interface DesktopUpdateControllerOptions {
  /** Running desktop version. */
  currentVersion: string
  /** Trusted GitHub Releases browser URL. */
  releaseUrl: string
  /** Static runtime reason updates cannot run, when applicable. */
  disabledReason?: Exclude<DesktopUpdateDisabledReason, 'policy'>
  /** Delay before an automatic startup check. */
  startupDelayMs: number
  /** Delay between successful or failed background checks. */
  intervalMs: number
  /** Duration of the manual up-to-date notice. */
  noticeDurationMs: number
  /** Durable policy owner. */
  preferences: Pick<DesktopUpdatePreferences, 'getPolicy' | 'subscribe'>
  /** Platform update implementation. */
  backend: DesktopUpdateBackend
  /** Timeout implementation. */
  scheduler: DesktopUpdateScheduler
  /** Clock used for checkedAt timestamps. */
  now: () => Date
  /** Clean-shutdown request invoked before installation. */
  requestInstall: () => Promise<void>
  /** Trusted external-navigation callback. */
  openReleasePage: () => Promise<void>
}

type StateBody =
  | { status: 'disabled'; reason: DesktopUpdateDisabledReason }
  | { status: 'idle'; notice?: 'up-to-date' }
  | { status: 'checking'; manual: boolean }
  | { status: 'available'; updateVersion: string; releaseDate?: string }
  | { status: 'downloading'; updateVersion: string; progress: DesktopUpdateProgress }
  | { status: 'ready'; updateVersion: string }
  | { status: 'error'; message: string; manual: boolean }

function zeroProgress(): DesktopUpdateProgress {
  return { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }
}

/** Main-process updater state owner. */
export class DesktopUpdateController {
  private readonly listeners = new Set<(state: DesktopUpdateState) => void>()
  private readonly disposers: Array<() => void> = []
  private policy: DesktopUpdatePolicy
  private revision = 0
  private checkedAt: string | undefined
  private state: DesktopUpdateState
  private checkTimer: unknown
  private noticeTimer: unknown
  private manualOperation = false
  private started = false
  private stopped = false

  /** @param options - release backend, settings owner, clock, and scheduling policy. */
  constructor(private readonly options: DesktopUpdateControllerOptions) {
    this.policy = options.preferences.getPolicy()
    this.state = this.buildInitialState()
  }

  /** @returns the immutable current updater state. */
  getState(): DesktopUpdateState {
    return this.state
  }

  /**
   * Observe state revisions.
   * @param listener - callback receiving each new immutable state.
   * @returns disposer removing the callback.
   */
  subscribe(listener: (state: DesktopUpdateState) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Start backend listeners, settings adoption, and the selected automatic schedule. */
  start(): void {
    if (this.started) throw new Error('desktop update controller is already started')
    if (this.stopped) throw new Error('desktop update controller cannot restart after stop')
    this.started = true
    this.disposers.push(
      this.options.backend.onAvailable((info) => { this.available(info) }),
      this.options.backend.onNotAvailable(() => { this.notAvailable() }),
      this.options.backend.onProgress((progress) => { this.progress(progress) }),
      this.options.backend.onDownloaded((info) => { this.downloaded(info) }),
      this.options.backend.onError((error) => { this.fail(error) }),
      this.options.preferences.subscribe((policy) => { this.adoptPolicy(policy) }),
    )
    this.scheduleStartup()
  }

  /** Stop timers and event delivery before the Electron process exits. */
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.clearCheckTimer()
    this.clearNoticeTimer()
    for (const dispose of this.disposers.splice(0).reverse()) dispose()
  }

  /**
   * Check for a newer release.
   * @param manual - whether a user gesture initiated the check.
   * @returns the state reached after the backend check promise settles.
   */
  async check(manual = true): Promise<DesktopUpdateState> {
    if (!this.canCheck()) return this.state
    if (this.state.status === 'checking'
      || this.state.status === 'downloading'
      || this.state.status === 'ready') return this.state
    if (manual) this.clearCheckTimer()
    this.clearNoticeTimer()
    this.manualOperation = manual
    this.publish({ status: 'checking', manual })
    try {
      await this.options.backend.checkForUpdates()
    } catch (error) {
      if (this.getState().status === 'checking') {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    } finally {
      if (manual) this.scheduleBackgroundInterval()
    }
    return this.state
  }

  /** @returns the state reached after an available update download settles. */
  async download(): Promise<DesktopUpdateState> {
    if (this.state.status !== 'available') return this.state
    const updateVersion = this.state.updateVersion
    this.manualOperation = true
    this.publish({ status: 'downloading', updateVersion, progress: zeroProgress() })
    try {
      await this.options.backend.downloadUpdate()
    } catch (error) {
      if (this.getState().status === 'downloading') {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    }
    return this.state
  }

  /** Ask the application shutdown coordinator to reach quiescence before installation. */
  async install(): Promise<DesktopUpdateState> {
    if (this.state.status === 'ready') await this.options.requestInstall()
    return this.state
  }

  /** Open the build-pinned GitHub Releases page. */
  async openReleases(): Promise<DesktopUpdateState> {
    await this.options.openReleasePage()
    return this.state
  }

  /**
   * Hand native quit ownership to the platform installer.
   * @param acknowledge - synchronously transfer native quit ownership.
   * @returns a promise settled after ownership transfer.
   */
  async quitAndInstall(acknowledge: () => void): Promise<void> {
    await this.options.backend.quitAndInstall(acknowledge)
  }

  private buildInitialState(): DesktopUpdateState {
    const reason = this.options.disabledReason ?? (this.policy === 'disabled' ? 'policy' : undefined)
    const body: StateBody = reason === undefined
      ? { status: 'idle' }
      : { status: 'disabled', reason }
    return Object.freeze({
      ...body,
      revision: this.revision,
      currentVersion: this.options.currentVersion,
      policy: this.policy,
      releaseUrl: this.options.releaseUrl,
    })
  }

  private publish(body: StateBody): void {
    if (this.stopped) return
    this.revision += 1
    this.state = Object.freeze({
      ...body,
      revision: this.revision,
      currentVersion: this.options.currentVersion,
      policy: this.policy,
      releaseUrl: this.options.releaseUrl,
      ...(this.checkedAt === undefined ? {} : { checkedAt: this.checkedAt }),
    })
    for (const listener of this.listeners) listener(this.state)
  }

  private available(info: DesktopReleaseInfo): void {
    this.checkedAt = this.options.now().toISOString()
    this.manualOperation = false
    this.clearCheckTimer()
    this.publish({
      status: 'available',
      updateVersion: info.version,
      ...(info.releaseDate === undefined ? {} : { releaseDate: info.releaseDate }),
    })
  }

  private notAvailable(): void {
    this.checkedAt = this.options.now().toISOString()
    const notice = this.manualOperation ? 'up-to-date' as const : undefined
    this.publish({ status: 'idle', ...(notice === undefined ? {} : { notice }) })
    this.manualOperation = false
    if (notice !== undefined) {
      this.noticeTimer = this.options.scheduler.set(() => {
        this.noticeTimer = undefined
        if (this.state.status === 'idle' && this.state.notice === 'up-to-date') {
          this.publish({ status: 'idle' })
        }
      }, this.options.noticeDurationMs)
    }
  }

  private progress(progress: DesktopUpdateProgress): void {
    if (this.state.status !== 'downloading') return
    this.publish({ status: 'downloading', updateVersion: this.state.updateVersion, progress })
  }

  private downloaded(info: DesktopReleaseInfo): void {
    this.manualOperation = false
    this.publish({ status: 'ready', updateVersion: info.version })
  }

  private fail(error: Error): void {
    const manual = this.manualOperation || this.state.status === 'downloading'
    this.checkedAt = this.options.now().toISOString()
    this.manualOperation = false
    this.publish({ status: 'error', message: error.message, manual })
    this.scheduleBackgroundInterval()
  }

  private adoptPolicy(policy: DesktopUpdatePolicy): void {
    if (policy === this.policy || this.stopped) return
    this.policy = policy
    this.clearCheckTimer()
    if (this.options.disabledReason !== undefined) {
      this.publish({ status: 'disabled', reason: this.options.disabledReason })
      return
    }
    if (policy === 'disabled') {
      if (this.state.status === 'available'
        || this.state.status === 'downloading'
        || this.state.status === 'ready') {
        this.publish(this.stateBody())
      } else {
        this.publish({ status: 'disabled', reason: 'policy' })
      }
      return
    }
    if (this.state.status === 'disabled') this.publish({ status: 'idle' })
    else this.publish(this.stateBody())
    this.scheduleStartup()
  }

  private stateBody(): StateBody {
    const { revision: _revision, currentVersion: _currentVersion, policy: _policy,
      releaseUrl: _releaseUrl, checkedAt: _checkedAt, ...body } = this.state
    return body
  }

  private canCheck(): boolean {
    return !this.stopped
      && this.options.disabledReason === undefined
      && this.policy !== 'disabled'
  }

  private scheduleStartup(): void {
    if (!this.canCheck() || (this.policy !== 'background' && this.policy !== 'startup')) return
    if (this.state.status === 'checking'
      || this.state.status === 'available'
      || this.state.status === 'downloading'
      || this.state.status === 'ready') return
    this.checkTimer = this.options.scheduler.set(() => {
      this.checkTimer = undefined
      void this.check(false).finally(() => {
        this.scheduleBackgroundInterval()
      })
    }, this.options.startupDelayMs)
  }

  private async runBackgroundCheck(): Promise<void> {
    await this.check(false)
    this.scheduleBackgroundInterval()
  }

  private scheduleBackgroundInterval(): void {
    if (this.policy !== 'background' || !this.canCheck()
      || this.state.status === 'checking'
      || this.state.status === 'available'
      || this.state.status === 'downloading'
      || this.state.status === 'ready') return
    this.clearCheckTimer()
    this.checkTimer = this.options.scheduler.set(() => {
      this.checkTimer = undefined
      void this.runBackgroundCheck()
    }, this.options.intervalMs)
  }

  private clearCheckTimer(): void {
    if (this.checkTimer === undefined) return
    this.options.scheduler.clear(this.checkTimer)
    this.checkTimer = undefined
  }

  private clearNoticeTimer(): void {
    if (this.noticeTimer === undefined) return
    this.options.scheduler.clear(this.noticeTimer)
    this.noticeTimer = undefined
  }
}
