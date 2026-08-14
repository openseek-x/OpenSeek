/** Bounded acknowledgement for handing control to a native update installer. */

/** Native updater events and action used by one installer handoff. */
export interface DesktopInstallerHandoffSource {
  /** Observe the native updater's transition into update-driven application quit. */
  onBeforeQuit(listener: () => void): () => void
  /** Observe an updater error before native quit begins. */
  onError(listener: (error: Error) => void): () => void
  /** Ask the platform updater to begin installation. */
  invoke(): void
}

/** Replaceable timer used to bound installer acknowledgement. */
export interface DesktopInstallerHandoffScheduler {
  /** Schedule one acknowledgement timeout. */
  set(callback: () => void, delayMs: number): unknown
  /** Clear one scheduled acknowledgement timeout. */
  clear(handle: unknown): void
}

const defaultScheduler: DesktopInstallerHandoffScheduler = {
  set(callback, delayMs) {
    return setTimeout(callback, delayMs)
  },
  clear(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

function errorOf(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Wait until the native updater owns application quit, or reject on error or timeout.
 * @param source - native acknowledgement, error, and installer invocation adapter.
 * @param timeoutMs - maximum time allowed for the platform updater to take control.
 * @param acknowledge - synchronously transfer quit ownership before acknowledgement resolves.
 * @param scheduler - timer adapter, replaceable for deterministic tests.
 * @returns a promise settled only after acknowledgement or a terminal failure.
 */
export function waitForDesktopInstallerHandoff(
  source: DesktopInstallerHandoffSource,
  timeoutMs: number,
  acknowledge: () => void,
  scheduler: DesktopInstallerHandoffScheduler = defaultScheduler,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    let disposeReady = (): void => undefined
    let disposeError = (): void => undefined
    const settle = (error?: Error): void => {
      if (settled) return
      settled = true
      scheduler.clear(timeout)
      disposeReady()
      disposeError()
      if (error === undefined) resolve()
      else reject(error)
    }
    disposeReady = source.onBeforeQuit(() => {
      try {
        acknowledge()
        settle()
      } catch (error) {
        settle(errorOf(error))
      }
    })
    disposeError = source.onError((error) => { settle(error) })
    const timeout = scheduler.set(() => {
      settle(new Error(`desktop update installer handoff exceeded ${String(timeoutMs)}ms`))
    }, timeoutMs)
    try {
      source.invoke()
    } catch (error) {
      settle(errorOf(error))
    }
  })
}
