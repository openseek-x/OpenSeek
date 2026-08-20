/** Validates renderer coordinates and calculates native-window drag positions. */

import type { IpcWindowDragPoint } from './ipc.ts'

const MAX_ABSOLUTE_SCREEN_COORDINATE = 1_000_000

/** Position understood by Electron's {@link BrowserWindow.setPosition} API. */
export interface NativeWindowPosition {
  readonly x: number
  readonly y: number
}

/** Initial native-window position and renderer pointer for one drag gesture. */
export interface WindowDragState {
  readonly pointer: IpcWindowDragPoint
  readonly position: NativeWindowPosition
}

/** Minimal native-window operations needed by the main-process drag controller. */
export interface NativeWindowDragOwner {
  /** @returns Whether Electron has already destroyed this native window. */
  isDestroyed: () => boolean
  /** @returns Whether the operating system currently permits moving this window. */
  isMovable: () => boolean
  /** @returns Current native-window coordinates with horizontal and vertical entries. */
  getPosition: () => readonly number[]
  /** @param x - New horizontal native-window coordinate. @param y - New vertical native-window coordinate. */
  setPosition: (x: number, y: number) => void
}

interface ActiveWindowDrag {
  readonly owner: NativeWindowDragOwner
  readonly state: WindowDragState
}

/**
 * Accept a finite screen coordinate within the range practical for desktop displays.
 * @param value - Structured-clone value received over Electron IPC.
 * @returns Whether `value` is a usable renderer screen position.
 */
export function isWindowDragPoint(value: unknown): value is IpcWindowDragPoint {
  if (typeof value !== 'object' || value === null) return false
  const point = value as Partial<IpcWindowDragPoint>
  return isScreenCoordinate(point.screenX) && isScreenCoordinate(point.screenY)
}

/**
 * Capture the immutable bases needed to calculate later native-window positions.
 * @param position - Native-window position at the beginning of the gesture.
 * @param pointer - Renderer pointer position at the beginning of the gesture.
 * @returns State to retain until the matching end message.
 */
export function startWindowDrag(position: NativeWindowPosition, pointer: IpcWindowDragPoint): WindowDragState {
  return { position, pointer }
}

/**
 * Apply a renderer pointer delta to the native-window position captured at drag start.
 * @param state - Position and pointer captured when the gesture began.
 * @param pointer - Latest renderer pointer position.
 * @returns Rounded native-window coordinates for the latest pointer position.
 */
export function nextWindowDragPosition(state: WindowDragState, pointer: IpcWindowDragPoint): NativeWindowPosition {
  return {
    x: Math.round(state.position.x + pointer.screenX - state.pointer.screenX),
    y: Math.round(state.position.y + pointer.screenY - state.pointer.screenY),
  }
}

/** Holds the native window that owns an accepted renderer drag gesture. */
export class WindowDragController {
  private active: ActiveWindowDrag | undefined

  /**
   * Begin or replace a gesture only when its owner remains movable and its payload is valid.
   * @param owner - Native window that received the validated renderer message.
   * @param value - Untrusted structured-clone drag payload.
   */
  start(owner: NativeWindowDragOwner, value: unknown): void {
    if (!isWindowDragPoint(value) || owner.isDestroyed() || !owner.isMovable()) return
    const [x, y] = owner.getPosition()
    if (x === undefined || y === undefined) return
    this.active = { owner, state: startWindowDrag({ x, y }, value) }
  }

  /**
   * Move only the window that started the active gesture.
   * @param owner - Native window that received the validated renderer message.
   * @param value - Untrusted structured-clone drag payload.
   */
  move(owner: NativeWindowDragOwner, value: unknown): void {
    if (!isWindowDragPoint(value)) return
    const active = this.active
    if (active === undefined || active.owner !== owner || owner.isDestroyed()) return
    const position = nextWindowDragPosition(active.state, value)
    owner.setPosition(position.x, position.y)
  }

  /**
   * End a gesture only when its owner sends the matching end message.
   * @param owner - Native window that received the validated renderer message.
   */
  end(owner: NativeWindowDragOwner): void {
    if (this.active?.owner === owner) this.active = undefined
  }

  /**
   * Clear all state during shutdown, or state belonging to a closing native window.
   * @param owner - Optional native-window owner whose state should be discarded.
   */
  clear(owner?: NativeWindowDragOwner): void {
    if (owner === undefined || this.active?.owner === owner) this.active = undefined
  }
}

function isScreenCoordinate(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Math.abs(value) <= MAX_ABSOLUTE_SCREEN_COORDINATE
}
