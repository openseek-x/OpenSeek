/** Held-pointer gesture state that the isolated preload maps onto native window movement. */

import type { IpcWindowDragPoint } from './ipc.ts'

/** Renderer pointer data used to distinguish one physical pointer from another. */
export interface WindowDragPointer extends IpcWindowDragPoint {
  readonly pointerId: number
}

/** Sender supplied by preload to forward accepted gesture transitions over IPC. */
export interface WindowDragSink {
  /** @param point - Renderer screen position at the beginning of a native-window drag. */
  start: (point: IpcWindowDragPoint) => void
  /** @param point - Latest renderer screen position while the native window moves. */
  move: (point: IpcWindowDragPoint) => void
  /** End the active native-window drag. */
  end: () => void
}

/** Tracks one held pointer without exposing Electron to the page world. */
export class WindowDragGesture {
  private activePointerId: number | undefined

  /**
   * @param sink - IPC sender invoked while a primary pointer remains held.
   */
  constructor(private readonly sink: WindowDragSink) {}

  /**
   * Begin native-window movement for the first held pointer.
   * @param pointer - Held pointer's id and screen position.
   */
  begin(pointer: WindowDragPointer): void {
    if (this.activePointerId !== undefined) return
    this.activePointerId = pointer.pointerId
    this.sink.start(pointOf(pointer))
  }

  /**
   * Move the native window while its initiating pointer remains held.
   * @param pointer - Latest pointer id and screen position.
   */
  move(pointer: WindowDragPointer): void {
    if (this.activePointerId === pointer.pointerId) this.sink.move(pointOf(pointer))
  }

  /**
   * Finish the gesture owned by one pointer.
   * @param pointerId - Pointer that ended or was cancelled by the browser.
   */
  end(pointerId: number): void {
    if (this.activePointerId !== pointerId) return
    this.activePointerId = undefined
    this.sink.end()
  }

  /** End a live native-window drag after its window loses focus. */
  cancel(): void {
    if (this.activePointerId === undefined) return
    this.activePointerId = undefined
    this.sink.end()
  }
}

function pointOf(pointer: WindowDragPointer): IpcWindowDragPoint {
  return { screenX: pointer.screenX, screenY: pointer.screenY }
}
