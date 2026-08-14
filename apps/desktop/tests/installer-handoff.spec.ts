import { describe, expect, it, vi } from 'vitest'
import {
  waitForDesktopInstallerHandoff,
  type DesktopInstallerHandoffScheduler,
  type DesktopInstallerHandoffSource,
} from '../src/installer-handoff.ts'

class Scheduler implements DesktopInstallerHandoffScheduler {
  callback: (() => void) | undefined
  cleared = false

  set(callback: () => void): unknown {
    this.callback = callback
    return 1
  }

  clear(): void {
    this.cleared = true
    this.callback = undefined
  }

  expire(): void {
    const callback = this.callback
    if (callback === undefined) throw new Error('handoff timeout is not scheduled')
    callback()
  }
}

class Source implements DesktopInstallerHandoffSource {
  readonly invoke = vi.fn()
  private beforeQuit: (() => void) | undefined
  private error: ((error: Error) => void) | undefined

  onBeforeQuit(listener: () => void): () => void {
    this.beforeQuit = listener
    return () => { if (this.beforeQuit === listener) this.beforeQuit = undefined }
  }

  onError(listener: (error: Error) => void): () => void {
    this.error = listener
    return () => { if (this.error === listener) this.error = undefined }
  }

  acknowledge(): void {
    this.beforeQuit?.()
  }

  fail(error: Error): void {
    this.error?.(error)
  }
}

describe('desktop installer handoff', () => {
  it('resolves only after the native updater acknowledges update-driven quit', async () => {
    const source = new Source()
    const scheduler = new Scheduler()
    const order: string[] = []
    const handoff = waitForDesktopInstallerHandoff(source, 120_000, () => {
      order.push('acknowledged')
    }, scheduler)
    void handoff.then(() => { order.push('resolved') })

    await Promise.resolve()
    expect(source.invoke).toHaveBeenCalledOnce()
    expect(order).toEqual([])
    source.acknowledge()
    expect(order).toEqual(['acknowledged'])
    await handoff

    expect(order).toEqual(['acknowledged', 'resolved'])
    expect(scheduler.cleared).toBe(true)
  })

  it('rejects an updater error and removes the acknowledgement timeout', async () => {
    const source = new Source()
    const scheduler = new Scheduler()
    const failure = new Error('native update verification failed')
    const acknowledge = vi.fn()
    const handoff = waitForDesktopInstallerHandoff(source, 120_000, acknowledge, scheduler)

    source.fail(failure)

    await expect(handoff).rejects.toBe(failure)
    expect(acknowledge).not.toHaveBeenCalled()
    expect(scheduler.cleared).toBe(true)
  })

  it('rejects when the native updater does not take control before the bound', async () => {
    const source = new Source()
    const scheduler = new Scheduler()
    const acknowledge = vi.fn()
    const handoff = waitForDesktopInstallerHandoff(source, 120_000, acknowledge, scheduler)

    scheduler.expire()

    await expect(handoff).rejects.toThrow('installer handoff exceeded 120000ms')
    expect(acknowledge).not.toHaveBeenCalled()
  })

  it('rejects when quit ownership cannot be transferred', async () => {
    const source = new Source()
    const scheduler = new Scheduler()
    const failure = new Error('quit ownership failed')
    const handoff = waitForDesktopInstallerHandoff(source, 120_000, () => { throw failure }, scheduler)

    source.acknowledge()

    await expect(handoff).rejects.toBe(failure)
    expect(scheduler.cleared).toBe(true)
  })
})
