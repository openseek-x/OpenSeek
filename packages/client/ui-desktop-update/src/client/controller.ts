/** React-free client projection of the Electron updater bridge. */

import type {
  DesktopUpdateAction,
  DesktopUpdateBridge,
  DesktopUpdateState,
} from '../protocol.ts'

/** Renderer-local state while the first IPC snapshot is pending or unavailable. */
export type DesktopUpdateClientState =
  | { readonly status: 'loading' }
  | { readonly status: 'bridge-error'; readonly message: string }
  | DesktopUpdateState

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Observable updater projection consumed through the slot inject-hooks seat. */
export class DesktopUpdateClientController {
  private snapshot: DesktopUpdateClientState = Object.freeze({ status: 'loading' })
  private readonly listeners = new Set<() => void>()
  private started = false

  /** @param bridge - validated context-isolated Electron updater bridge. */
  constructor(private readonly bridge: DesktopUpdateBridge) {}

  /**
   * Read the cached state for an external-store consumer.
   * @returns the cached state reference until a newer bridge revision arrives.
   */
  getSnapshot(): DesktopUpdateClientState {
    return this.snapshot
  }

  /**
   * Observe state replacements.
   * @param listener - callback invoked after the cached state changes.
   * @returns disposer removing the callback.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Subscribe before requesting the initial state so an intervening event
   * cannot be overwritten by a stale IPC reply.
   * @returns disposer stopping bridge delivery.
   */
  start(): () => void {
    if (this.started) throw new Error('desktop update client controller is already started')
    this.started = true
    let active = true
    const off = this.bridge.onState((state) => {
      if (active) this.accept(state)
    })
    void this.bridge.getState().then(
      (state) => { if (active) this.accept(state) },
      (error: unknown) => {
        if (active && !('revision' in this.snapshot)) this.fail(error)
      },
    )
    return () => {
      active = false
      off()
      this.started = false
    }
  }

  /** Ask the main process to check the signed release channel now. */
  check(): void {
    this.act('check')
  }

  /** Ask the main process to download the available update. */
  download(): void {
    this.act('download')
  }

  /** Ask the main process to stop the Harness cleanly and install the downloaded update. */
  install(): void {
    this.act('install')
  }

  /** Open the trusted GitHub Releases page in the operating-system browser. */
  openReleasePage(): void {
    this.act('open-release')
  }

  private act(action: DesktopUpdateAction): void {
    void this.bridge.act(action).then(
      (state) => { this.accept(state) },
      (error: unknown) => { this.fail(error) },
    )
  }

  private accept(next: DesktopUpdateState): void {
    const current = this.snapshot
    if ('revision' in current && next.revision <= current.revision) return
    this.publish(Object.freeze(next))
  }

  private fail(error: unknown): void {
    this.publish(Object.freeze({ status: 'bridge-error', message: messageOf(error) }))
  }

  private publish(next: DesktopUpdateClientState): void {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}
