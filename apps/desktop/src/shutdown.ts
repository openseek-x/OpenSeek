/** Process-neutral finalization policy for Electron shutdown and update installation. */

import type { ProfileLifecycle } from '@deepseek-ai/dsh/profile-boot'

/** Reason the Electron lifecycle requested finalization. */
export type DesktopShutdownIntent = 'quit' | 'install'

type CallerProfileLifecycle = Extract<ProfileLifecycle, { kind: 'caller' }>

/** Caller-owned profile lifecycle exposed to the Electron main process. */
export interface DesktopProfileLifecycle {
  /** Lifecycle callbacks passed into `runProfile`. */
  profileLifecycle: CallerProfileLifecycle
  /** Mark the point after which a missing shutdown attachment is an error. */
  beginBoot(): void
  /** Reach profile quiescence, or resolve when profile boot never began. */
  quiesce(exitCode: number): Promise<void>
}

/**
 * Join early profile attachment, in-profile exit requests, and Electron quiescence.
 * @param requestExit - callback routing `ctx.appExit` into Electron finalization.
 * @returns lifecycle callbacks and the corresponding bounded quiescence action.
 */
export function createDesktopProfileLifecycle(
  requestExit: (code: number) => void,
): DesktopProfileLifecycle {
  let bootStarted = false
  let shutdown: Parameters<CallerProfileLifecycle['attach']>[0] | undefined
  return {
    profileLifecycle: {
      kind: 'caller',
      attach: (controller) => {
        if (shutdown !== undefined && shutdown !== controller) {
          throw new Error('desktop profile shutdown was attached more than once')
        }
        shutdown = controller
      },
      requestExit,
    },
    beginBoot() {
      bootStarted = true
    },
    async quiesce(exitCode) {
      if (shutdown !== undefined) {
        await shutdown.shutdown(exitCode)
        return
      }
      if (bootStarted) throw new Error('desktop profile shutdown was not attached')
    },
  }
}

/** Native actions used after the in-process Harness reaches quiescence. */
export interface DesktopShutdownActions {
  /** Best-effort local cleanup that must finish before Harness disposal. */
  cleanup?: ReadonlyArray<() => void>
  /** Await bounded Harness disposal. */
  quiesce: () => Promise<void>
  /** Hand control to the platform installer, when an update is ready. */
  quitAndInstall?: () => Promise<void>
  /** Ask Electron to complete a normal application quit. */
  quit: () => void
  /** Terminate Electron with a specific failure status. */
  exit: (code: number) => void
  /** Record a finalization failure before termination. */
  report: (stage: 'cleanup' | 'shutdown' | 'update installation', error: unknown) => void
}

/**
 * Run one best-effort diagnostic without interrupting application finalization.
 * @param report - diagnostic formatter and output action.
 */
export function reportDesktopFailure(report: () => void): void {
  try {
    report()
  } catch {
    // Diagnostics cannot supersede cleanup, quiescence, or native exit.
  }
}

function safeReport(
  actions: DesktopShutdownActions,
  stage: 'cleanup' | 'shutdown' | 'update installation',
  error: unknown,
): void {
  reportDesktopFailure(() => {
    actions.report(stage, error)
  })
}

/**
 * Reach quiescence before selecting exactly one native final action.
 * @param intent - ordinary quit or requested update installation.
 * @param exitCode - requested application completion status.
 * @param actions - injected Harness and native lifecycle actions.
 */
export async function finalizeDesktopShutdown(
  intent: DesktopShutdownIntent,
  exitCode: number,
  actions: DesktopShutdownActions,
): Promise<void> {
  let cleanupFailed = false
  for (const cleanup of actions.cleanup ?? []) {
    try {
      cleanup()
    } catch (error) {
      cleanupFailed = true
      safeReport(actions, 'cleanup', error)
    }
  }
  try {
    await actions.quiesce()
  } catch (error) {
    safeReport(actions, 'shutdown', error)
    actions.exit(exitCode === 0 ? 1 : exitCode)
    return
  }
  if (cleanupFailed) {
    actions.exit(exitCode === 0 ? 1 : exitCode)
    return
  }
  if (intent === 'install' && actions.quitAndInstall !== undefined) {
    try {
      await actions.quitAndInstall()
      return
    } catch (error) {
      safeReport(actions, 'update installation', error)
      actions.exit(1)
      return
    }
  }
  if (exitCode === 0) actions.quit()
  else actions.exit(exitCode)
}

/**
 * Coalesce desktop finalization so the first intent and exit status own teardown.
 * @param finalize - one complete cleanup, quiescence, and native-finalization run.
 * @returns a request function whose later calls join the first promise.
 */
export function createDesktopShutdownRequest(
  finalize: (intent: DesktopShutdownIntent, exitCode: number) => Promise<void>,
): DesktopShutdownRequest {
  let pending: Promise<void> | undefined
  return Object.assign(
    (intent: DesktopShutdownIntent, exitCode = 0) => {
      if (pending !== undefined) return pending
      let resolveFinalization!: () => void
      let rejectFinalization!: (error: unknown) => void
      const shared = new Promise<void>((resolve, reject) => {
        resolveFinalization = resolve
        rejectFinalization = reject
      })
      pending = shared
      try {
        void finalize(intent, exitCode).then(resolveFinalization, rejectFinalization)
      } catch (error) {
        rejectFinalization(error)
      }
      return shared
    },
    { isRequested: () => pending !== undefined },
  )
}

/** Coalesced finalization request with a synchronous startup guard. */
export interface DesktopShutdownRequest {
  /**
   * Request or join finalization with the first intent and exit status.
   * @param intent - ordinary quit or requested update installation.
   * @param exitCode - requested application completion status.
   * @returns the shared finalization promise.
   */
  (intent: DesktopShutdownIntent, exitCode?: number): Promise<void>
  /** @returns whether finalization has already been requested. */
  isRequested(): boolean
}

/** Native actions selected by an operating-system signal. */
export interface DesktopSignalActions {
  /** Whether application finalization is already underway. */
  shuttingDown: boolean
  /** Begin graceful finalization with the signal status. */
  requestShutdown: (exitCode: number) => void
  /** Terminate immediately when a separate finalization already owns teardown. */
  forceExit: (exitCode: number) => void
  /** Arm a bounded fallback for a newly requested graceful finalization. */
  scheduleForceExit: (exitCode: number) => void
}

/**
 * Preserve signal status through graceful finalization or force an existing shutdown.
 * @param exitCode - conventional process status for the received signal.
 * @param actions - current lifecycle state and Electron process actions.
 */
export function handleDesktopSignal(exitCode: number, actions: DesktopSignalActions): void {
  if (actions.shuttingDown) {
    actions.forceExit(exitCode)
    return
  }
  actions.requestShutdown(exitCode)
  actions.scheduleForceExit(exitCode)
}
