import { describe, expect, it, vi } from 'vitest'
import type {
  DesktopUpdatePolicy,
  DesktopUpdateProgress,
  DesktopUpdateState,
} from '@deepseek-ai/dsh-client-connection/desktop-update'
import {
  DesktopUpdateController,
  type DesktopReleaseInfo,
  type DesktopUpdateBackend,
  type DesktopUpdateScheduler,
} from '../src/update-controller.ts'

class Preferences {
  private readonly listeners = new Set<(policy: DesktopUpdatePolicy) => void>()

  constructor(private policy: DesktopUpdatePolicy) {}

  getPolicy(): DesktopUpdatePolicy {
    return this.policy
  }

  subscribe(listener: (policy: DesktopUpdatePolicy) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(policy: DesktopUpdatePolicy): void {
    this.policy = policy
    for (const listener of this.listeners) listener(policy)
  }
}

type BackendEvents = {
  available: DesktopReleaseInfo
  notAvailable: undefined
  progress: DesktopUpdateProgress
  downloaded: DesktopReleaseInfo
  error: Error
}

class Backend implements DesktopUpdateBackend {
  private readonly listeners: { [K in keyof BackendEvents]: Set<(value: BackendEvents[K]) => void> } = {
    available: new Set(),
    notAvailable: new Set(),
    progress: new Set(),
    downloaded: new Set(),
    error: new Set(),
  }

  checkCalls = 0
  downloadCalls = 0
  installCalls = 0
  acknowledgeInstall: (() => void) | undefined
  onCheck: () => Promise<void> = async () => {}
  onDownload: () => Promise<void> = async () => {}

  onAvailable(listener: (info: DesktopReleaseInfo) => void): () => void {
    return this.on('available', listener)
  }

  onNotAvailable(listener: () => void): () => void {
    return this.on('notAvailable', listener)
  }

  onProgress(listener: (progress: DesktopUpdateProgress) => void): () => void {
    return this.on('progress', listener)
  }

  onDownloaded(listener: (info: DesktopReleaseInfo) => void): () => void {
    return this.on('downloaded', listener)
  }

  onError(listener: (error: Error) => void): () => void {
    return this.on('error', listener)
  }

  async checkForUpdates(): Promise<void> {
    this.checkCalls += 1
    await this.onCheck()
  }

  async downloadUpdate(): Promise<void> {
    this.downloadCalls += 1
    await this.onDownload()
  }

  async quitAndInstall(acknowledge: () => void): Promise<void> {
    this.installCalls += 1
    this.acknowledgeInstall = acknowledge
  }

  emit<K extends keyof BackendEvents>(event: K, value: BackendEvents[K]): void {
    for (const listener of this.listeners[event]) listener(value)
  }

  private on<K extends keyof BackendEvents>(event: K, listener: (value: BackendEvents[K]) => void): () => void {
    this.listeners[event].add(listener)
    return () => { this.listeners[event].delete(listener) }
  }
}

class Scheduler implements DesktopUpdateScheduler {
  private sequence = 0
  readonly tasks = new Map<number, { callback: () => void; delayMs: number }>()

  set(callback: () => void, delayMs: number): unknown {
    this.sequence += 1
    this.tasks.set(this.sequence, { callback, delayMs })
    return this.sequence
  }

  clear(handle: unknown): void {
    this.tasks.delete(handle as number)
  }

  run(delayMs: number): void {
    const entry = [...this.tasks].find(([, task]) => task.delayMs === delayMs)
    if (entry === undefined) throw new Error(`no scheduled task with delay ${String(delayMs)}`)
    this.tasks.delete(entry[0])
    entry[1].callback()
  }
}

function fixture(policy: DesktopUpdatePolicy = 'background', disabledReason?: 'development') {
  const preferences = new Preferences(policy)
  const backend = new Backend()
  const scheduler = new Scheduler()
  const requestInstall = vi.fn<() => Promise<void>>(async () => {})
  const openReleasePage = vi.fn<() => Promise<void>>(async () => {})
  const controller = new DesktopUpdateController({
    currentVersion: '1.2.3',
    releaseUrl: 'https://github.com/openseek-x/OpenSeek/releases/latest',
    ...(disabledReason === undefined ? {} : { disabledReason }),
    startupDelayMs: 30_000,
    intervalMs: 14_400_000,
    noticeDurationMs: 5_000,
    preferences,
    backend,
    scheduler,
    now: () => new Date('2026-08-14T01:02:03.000Z'),
    requestInstall,
    openReleasePage,
  })
  return { backend, controller, openReleasePage, preferences, requestInstall, scheduler }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function expectOnlyScheduledDelay(scheduler: Scheduler, delayMs: number): void {
  expect([...scheduler.tasks.values()].map(task => task.delayMs)).toEqual([delayMs])
}

describe('DesktopUpdateController', () => {
  it('keeps statically disabled builds offline while retaining the trusted release link', async () => {
    const { backend, controller, openReleasePage, preferences, scheduler } = fixture('background', 'development')
    const states: DesktopUpdateState[] = []
    const dispose = controller.subscribe((state) => { states.push(state) })

    expect(controller.getState()).toMatchObject({ status: 'disabled', reason: 'development', revision: 0 })
    controller.start()
    expect(scheduler.tasks.size).toBe(0)
    expect(await controller.check()).toBe(controller.getState())
    expect(backend.checkCalls).toBe(0)
    await controller.openReleases()
    expect(openReleasePage).toHaveBeenCalledOnce()

    preferences.set('manual')
    expect(controller.getState()).toMatchObject({ status: 'disabled', reason: 'development', policy: 'manual' })
    expect(states).toHaveLength(1)
    dispose()
    controller.stop()
    controller.stop()
    backend.emit('error', new Error('late'))
    expect(states).toHaveLength(1)
  })

  it('runs startup and interval checks and makes only a manual no-update result visible', async () => {
    const { backend, controller, scheduler } = fixture()
    backend.onCheck = async () => { backend.emit('notAvailable', undefined) }
    controller.start()

    expectOnlyScheduledDelay(scheduler, 30_000)
    scheduler.run(30_000)
    await settle()
    expect(backend.checkCalls).toBe(1)
    expect(controller.getState()).toMatchObject({ status: 'idle', revision: 2, checkedAt: '2026-08-14T01:02:03.000Z' })
    expect(controller.getState()).not.toHaveProperty('notice')
    expectOnlyScheduledDelay(scheduler, 14_400_000)

    scheduler.run(14_400_000)
    await settle()
    expect(backend.checkCalls).toBe(2)
    expectOnlyScheduledDelay(scheduler, 14_400_000)

    await controller.check(true)
    expect(controller.getState()).toMatchObject({ status: 'idle', notice: 'up-to-date' })
    expect([...scheduler.tasks.values()].some(task => task.delayMs === 5_000)).toBe(true)
    scheduler.run(5_000)
    expect(controller.getState()).toMatchObject({ status: 'idle' })
    expect(controller.getState()).not.toHaveProperty('notice')
  })

  it('moves an available release through explicit download and clean-shutdown installation', async () => {
    const { backend, controller, openReleasePage, preferences, requestInstall, scheduler } = fixture('manual')
    controller.start()
    expect(scheduler.tasks.size).toBe(0)
    backend.onCheck = async () => {
      backend.emit('available', { version: '1.3.0', releaseDate: '2026-08-14T00:00:00.000Z' })
    }

    await controller.check()
    expect(controller.getState()).toMatchObject({
      status: 'available',
      updateVersion: '1.3.0',
      releaseDate: '2026-08-14T00:00:00.000Z',
    })
    preferences.set('disabled')
    expect(controller.getState()).toMatchObject({ status: 'available', policy: 'disabled' })

    backend.onDownload = async () => {
      backend.emit('progress', { percent: 50, transferred: 10, total: 20, bytesPerSecond: 5 })
      backend.emit('downloaded', { version: '1.3.0' })
    }
    await controller.download()
    expect(backend.downloadCalls).toBe(1)
    expect(controller.getState()).toMatchObject({ status: 'ready', updateVersion: '1.3.0' })
    await controller.install()
    expect(requestInstall).toHaveBeenCalledOnce()
    const acknowledge = vi.fn()
    await controller.quitAndInstall(acknowledge)
    expect(backend.installCalls).toBe(1)
    expect(backend.acknowledgeInstall).toBe(acknowledge)
    await controller.openReleases()
    expect(openReleasePage).toHaveBeenCalledOnce()
  })

  it('does not duplicate backend errors also returned as rejected operations', async () => {
    const { backend, controller } = fixture('manual')
    controller.start()
    backend.onCheck = async () => {
      const error = new Error('metadata unavailable')
      backend.emit('error', error)
      throw error
    }
    await controller.check()
    expect(controller.getState()).toMatchObject({
      status: 'error',
      message: 'metadata unavailable',
      manual: true,
      revision: 2,
    })

    backend.emit('available', { version: '2.0.0' })
    backend.onDownload = async () => {
      const error = new Error('transfer failed')
      backend.emit('error', error)
      throw error
    }
    await controller.download()
    expect(controller.getState()).toMatchObject({
      status: 'error',
      message: 'transfer failed',
      manual: true,
      revision: 5,
    })
    expect(await controller.download()).toBe(controller.getState())
    expect(await controller.install()).toBe(controller.getState())
  })

  it('adopts policy changes with one owned timer and rejects invalid lifecycle reuse', () => {
    const { controller, preferences, scheduler } = fixture()
    controller.start()
    expect(() => { controller.start() }).toThrow('already started')
    preferences.set('manual')
    expect(scheduler.tasks.size).toBe(0)
    preferences.set('disabled')
    expect(controller.getState()).toMatchObject({ status: 'disabled', reason: 'policy' })
    preferences.set('startup')
    expect(controller.getState()).toMatchObject({ status: 'idle', policy: 'startup' })
    expect([...scheduler.tasks.values()].map(task => task.delayMs)).toEqual([30_000])
    preferences.set('startup')
    expect(scheduler.tasks.size).toBe(1)
    controller.stop()
    expect(scheduler.tasks.size).toBe(0)
    expect(() => { controller.start() }).toThrow('already started')

    const stopped = fixture('manual').controller
    stopped.stop()
    expect(() => { stopped.start() }).toThrow('cannot restart')
  })
})
