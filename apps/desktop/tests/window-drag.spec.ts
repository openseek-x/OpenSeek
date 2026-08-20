import { describe, expect, it, vi } from 'vitest'
import {
  WindowDragGesture,
  type WindowDragSink,
} from '../src/window-drag-gesture.ts'
import {
  isWindowDragPoint,
  nextWindowDragPosition,
  startWindowDrag,
  WindowDragController,
  type NativeWindowDragOwner,
} from '../src/window-drag.ts'

function point(pointerId: number, screenX: number, screenY: number) {
  return { pointerId, screenX, screenY }
}

function gesture() {
  const sink: WindowDragSink = {
    start: vi.fn(),
    move: vi.fn(),
    end: vi.fn(),
  }
  const subject = new WindowDragGesture(sink)
  return { sink, subject }
}

function nativeWindow(overrides: Partial<NativeWindowDragOwner> = {}) {
  let x = 100
  let y = 200
  const owner: NativeWindowDragOwner = {
    isDestroyed: () => false,
    isMovable: () => true,
    getPosition: () => [x, y],
    setPosition: (nextX, nextY) => { x = nextX; y = nextY },
    ...overrides,
  }
  return {
    owner,
    position: () => ({ x, y }),
  }
}

describe('desktop window-drag coordinates', () => {
  it('accepts finite screen positions and rejects malformed IPC payloads', () => {
    expect(isWindowDragPoint({ screenX: -2_000, screenY: 8_000 })).toBe(true)
    expect(isWindowDragPoint(undefined)).toBe(false)
    expect(isWindowDragPoint({ screenX: 1, screenY: Number.NaN })).toBe(false)
    expect(isWindowDragPoint({ screenX: Number.POSITIVE_INFINITY, screenY: 1 })).toBe(false)
    expect(isWindowDragPoint({ screenX: 1_000_001, screenY: 1 })).toBe(false)
  })

  it('moves from the position captured at drag start instead of compounding deltas', () => {
    const state = startWindowDrag({ x: 100, y: 200 }, { screenX: 10.2, screenY: 20.8 })

    expect(nextWindowDragPosition(state, { screenX: 31.8, screenY: -5.1 })).toEqual({ x: 122, y: 174 })
  })

  it('moves only the native window that owns a valid active gesture', () => {
    const controller = new WindowDragController()
    const first = nativeWindow()
    const second = nativeWindow()

    controller.start(first.owner, { screenX: 10, screenY: 20 })
    controller.move(second.owner, { screenX: 90, screenY: 80 })
    expect(second.position()).toEqual({ x: 100, y: 200 })

    controller.move(first.owner, { screenX: 90, screenY: 80 })
    expect(first.position()).toEqual({ x: 180, y: 260 })
    controller.end(second.owner)
    controller.move(first.owner, { screenX: 100, screenY: 90 })
    expect(first.position()).toEqual({ x: 190, y: 270 })

    controller.end(first.owner)
    controller.move(first.owner, { screenX: 120, screenY: 100 })
    expect(first.position()).toEqual({ x: 190, y: 270 })
  })

  it('rejects malformed data and windows the operating system cannot move', () => {
    const controller = new WindowDragController()
    const invalid = nativeWindow()
    const fixed = nativeWindow({ isMovable: () => false })
    const positionless = nativeWindow({ getPosition: () => [] })

    controller.start(invalid.owner, { screenX: Number.NaN, screenY: 20 })
    controller.move(invalid.owner, { screenX: 90, screenY: 80 })
    expect(invalid.position()).toEqual({ x: 100, y: 200 })

    controller.start(fixed.owner, { screenX: 10, screenY: 20 })
    controller.move(fixed.owner, { screenX: 90, screenY: 80 })
    expect(fixed.position()).toEqual({ x: 100, y: 200 })

    controller.start(positionless.owner, { screenX: 10, screenY: 20 })
    controller.move(positionless.owner, { screenX: 90, screenY: 80 })
    expect(positionless.position()).toEqual({ x: 100, y: 200 })
  })
})

describe('desktop window press-and-drag', () => {
  it('starts immediately and forwards later movement from the same pointer', () => {
    const { sink, subject } = gesture()
    subject.begin(point(4, 100, 200))

    expect(sink.start).toHaveBeenCalledWith({ screenX: 100, screenY: 200 })
    subject.move(point(4, 180, 260))
    expect(sink.move).toHaveBeenCalledWith({ screenX: 180, screenY: 260 })

    subject.end(4)
    expect(sink.end).toHaveBeenCalledOnce()
  })

  it('keeps later pointers out of the active native-window drag path', () => {
    const { sink, subject } = gesture()
    subject.begin(point(4, 100, 200))
    subject.begin(point(5, 200, 300))
    subject.move(point(5, 280, 360))
    subject.end(5)

    expect(sink.start).toHaveBeenCalledOnce()
    expect(sink.move).not.toHaveBeenCalled()
    expect(sink.end).not.toHaveBeenCalled()
    subject.end(4)
    expect(sink.end).toHaveBeenCalledOnce()
  })

  it('ends an active drag when the window loses its pointer stream', () => {
    const { sink, subject } = gesture()
    subject.begin(point(4, 100, 200))

    subject.cancel()

    expect(sink.end).toHaveBeenCalledOnce()
  })
})
