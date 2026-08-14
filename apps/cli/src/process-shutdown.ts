/** Bounded, escalating process shutdown for the long-lived CLI surfaces. */

/** Maximum grace allowed for the application tree to dispose before process exit. */
export const PROCESS_SHUTDOWN_TIMEOUT_MS = 5_000

/** Awaitable graceful shutdown shared by process-owned and caller-owned lifecycles. */
export interface ApplicationShutdown {
  /** Start or join graceful disposal. */
  shutdown(code: number): Promise<void>
}

/** Process-exit controller shared by normal completion and Unix signal handlers. */
export interface ProcessShutdown extends ApplicationShutdown {
  /** Start or join graceful disposal before allowing natural completion with `code`. */
  shutdown(code: number): Promise<void>
  /** Start graceful disposal followed by exit, or force exit when shutdown is already running. */
  interrupt(code: number): void
}

/**
 * Create bounded shutdown for an embedder that owns final process termination.
 * @param dispose - Whole-application teardown that resolves at quiescence.
 * @param timeoutMs - Grace before rejecting so the caller can choose how to terminate.
 * @returns A coalescing controller that never writes process exit state.
 */
export function createCallerOwnedShutdown(
  dispose: () => Promise<void>,
  timeoutMs = PROCESS_SHUTDOWN_TIMEOUT_MS,
): ApplicationShutdown {
  let pending: Promise<void> | undefined

  return {
    shutdown(_code) {
      pending ??= new Promise<void>((resolve, reject) => {
        let settled = false
        const timeout = setTimeout(() => {
          if (settled) return
          settled = true
          reject(new Error(`application shutdown exceeded ${String(timeoutMs)}ms`))
        }, timeoutMs)
        Promise.resolve().then(dispose).then(
          () => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            resolve()
          },
          (error: unknown) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            reject(error instanceof Error ? error : new Error(String(error)))
          },
        )
      })
      return pending
    },
  }
}

/**
 * Create one process-exit controller around an application disposer.
 * @param dispose - Whole-application teardown that resolves at quiescence.
 * @param forceExit - Function that exits the process immediately, replaceable by tests.
 * @param complete - Function that records the natural completion code, replaceable by tests.
 * @param timeoutMs - Grace before forced exit, replaceable by tests.
 * @returns A controller whose normal calls coalesce and whose repeated signal call escalates.
 */
export function createProcessShutdown(
  dispose: () => Promise<void>,
  forceExit: (code: number) => void = (code) => { process.exit(code) },
  complete: (code: number) => void = (code) => { process.exitCode = code },
  timeoutMs = PROCESS_SHUTDOWN_TIMEOUT_MS,
): ProcessShutdown {
  let pending: Promise<void> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let completed = false
  let forceExited = false

  const clearExitTimeout = (): void => {
    /* v8 ignore else -- shutdown() arms the timer before any asynchronous exit path can run. */
    if (timeout !== undefined) clearTimeout(timeout)
  }

  const forceExitOnce = (code: number): void => {
    if (forceExited) return
    forceExited = true
    clearExitTimeout()
    forceExit(code)
  }

  const completeOnce = (code: number): void => {
    if (completed || forceExited) return
    completed = true
    clearExitTimeout()
    complete(code)
  }

  const start = (code: number, forceAfterDispose: boolean): Promise<void> => {
    if (pending !== undefined) return pending
    timeout = setTimeout(() => { forceExitOnce(code) }, timeoutMs)
    pending = Promise.resolve().then(dispose).then(
      () => {
        if (forceAfterDispose) forceExitOnce(code)
        else completeOnce(code)
      },
      () => { forceExitOnce(code) },
    )
    return pending
  }

  return {
    shutdown(code) {
      return start(code, false)
    },
    interrupt(code) {
      if (pending !== undefined) {
        forceExitOnce(code)
        return
      }
      void start(code, true)
    },
  }
}
