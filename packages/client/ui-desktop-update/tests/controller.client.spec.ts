import { describe, expect, it, vi } from 'vitest'
import type {
  DesktopUpdateAction,
  DesktopUpdateBridge,
  DesktopUpdateState,
} from '../src/protocol.ts'
import { DesktopUpdateClientController } from '../src/client/controller.ts'
import { updateState } from './helpers.client.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function bridgeWith(getState: () => Promise<DesktopUpdateState>) {
  let listener: ((state: DesktopUpdateState) => void) | undefined
  const off = vi.fn()
  const act = vi.fn<(action: DesktopUpdateAction) => Promise<DesktopUpdateState>>()
  const bridge: DesktopUpdateBridge = {
    getState,
    act,
    onState: vi.fn((next: (state: DesktopUpdateState) => void) => {
      listener = next
      return off
    }),
  }
  return { bridge, act, off, emit: (state: DesktopUpdateState) => { listener?.(state) } }
}

describe('DesktopUpdateClientController', () => {
  it('subscribes before the initial read and fences stale replies by revision', async () => {
    const pending = deferred<DesktopUpdateState>()
    const b = bridgeWith(() => pending.promise)
    const controller = new DesktopUpdateClientController(b.bridge)
    const initial = controller.getSnapshot()
    expect(initial).toEqual({ status: 'loading' })
    expect(controller.getSnapshot()).toBe(initial)
    const changed = vi.fn()
    const unsubscribe = controller.subscribe(changed)
    const stop = controller.start()
    expect(() => controller.start()).toThrow(/already started/)

    const live = updateState({ status: 'available', updateVersion: '1.2.0' }, { revision: 2 })
    b.emit(live)
    expect(controller.getSnapshot()).toEqual(live)
    expect(Object.isFrozen(controller.getSnapshot())).toBe(true)
    pending.resolve(updateState({ status: 'idle' }, { revision: 1 }))
    await pending.promise
    await Promise.resolve()
    expect(controller.getSnapshot()).toEqual(live)
    expect(changed).toHaveBeenCalledOnce()

    b.emit(updateState({ status: 'ready', updateVersion: '1.2.0' }, { revision: 2 }))
    expect(changed).toHaveBeenCalledOnce()
    unsubscribe()
    b.emit(updateState({ status: 'ready', updateVersion: '1.2.0' }, { revision: 3 }))
    expect(changed).toHaveBeenCalledOnce()

    stop()
    expect(b.off).toHaveBeenCalledOnce()
    const restart = controller.start()
    restart()
    expect(b.off).toHaveBeenCalledTimes(2)
  })

  it('reports an initial bridge failure but preserves an event received before a failed reply', async () => {
    const first = bridgeWith(() => Promise.reject(new Error('IPC unavailable')))
    const controller = new DesktopUpdateClientController(first.bridge)
    controller.start()
    await vi.waitFor(() => {
      expect(controller.getSnapshot()).toEqual({ status: 'bridge-error', message: 'IPC unavailable' })
    })

    const pending = deferred<DesktopUpdateState>()
    const second = bridgeWith(() => pending.promise)
    const guarded = new DesktopUpdateClientController(second.bridge)
    guarded.start()
    const event = updateState({ status: 'idle' }, { revision: 4 })
    second.emit(event)
    pending.reject(new Error('late initial failure'))
    await pending.promise.catch(() => undefined)
    await Promise.resolve()
    expect(guarded.getSnapshot()).toEqual(event)
  })

  it('routes every action and publishes successful action replies', async () => {
    const b = bridgeWith(() => Promise.resolve(updateState({ status: 'idle' })))
    const controller = new DesktopUpdateClientController(b.bridge)
    const replies: Record<DesktopUpdateAction, DesktopUpdateState> = {
      check: updateState({ status: 'checking', manual: true }, { revision: 2 }),
      download: updateState({
        status: 'downloading',
        updateVersion: '1.2.0',
        progress: { percent: 10, transferred: 10, total: 100, bytesPerSecond: 5 },
      }, { revision: 3 }),
      install: updateState({ status: 'ready', updateVersion: '1.2.0' }, { revision: 4 }),
      'open-release': updateState({ status: 'idle' }, { revision: 5 }),
    }
    b.act.mockImplementation(action => Promise.resolve(replies[action]))

    controller.check()
    controller.download()
    controller.install()
    controller.openReleasePage()

    await vi.waitFor(() => {
      expect(b.act.mock.calls.map(call => call[0])).toEqual([
        'check', 'download', 'install', 'open-release',
      ])
      expect(controller.getSnapshot()).toEqual(replies['open-release'])
    })
  })

  it('turns a rejected action into a renderer-local bridge error', async () => {
    const b = bridgeWith(() => Promise.resolve(updateState({ status: 'idle' })))
    b.act.mockRejectedValue('transport closed')
    const controller = new DesktopUpdateClientController(b.bridge)
    const changed = vi.fn()
    controller.subscribe(changed)
    controller.check()
    await vi.waitFor(() => {
      expect(controller.getSnapshot()).toEqual({ status: 'bridge-error', message: 'transport closed' })
    })
    expect(changed).toHaveBeenCalledOnce()
  })

  it('ignores an initial snapshot that settles after disposal', async () => {
    const pending = deferred<DesktopUpdateState>()
    const b = bridgeWith(() => pending.promise)
    const controller = new DesktopUpdateClientController(b.bridge)
    const stop = controller.start()
    stop()
    b.emit(updateState({ status: 'available', updateVersion: '1.2.0' }, { revision: 2 }))
    pending.resolve(updateState({ status: 'idle' }))
    await pending.promise
    await Promise.resolve()
    expect(controller.getSnapshot()).toEqual({ status: 'loading' })
  })
})
