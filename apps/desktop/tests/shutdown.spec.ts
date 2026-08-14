import { describe, expect, it, vi } from 'vitest'
import {
  createDesktopProfileLifecycle,
  createDesktopShutdownRequest,
  finalizeDesktopShutdown,
  handleDesktopSignal,
  reportDesktopFailure,
  type DesktopShutdownActions,
} from '../src/shutdown.ts'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((accept) => { resolve = accept })
  return { promise, resolve }
}

function fixture(overrides: Partial<DesktopShutdownActions> = {}): DesktopShutdownActions {
  return {
    quiesce: vi.fn(async () => {}),
    quitAndInstall: vi.fn(async () => {}),
    quit: vi.fn(),
    exit: vi.fn(),
    report: vi.fn(),
    ...overrides,
  }
}

describe('desktop shutdown finalization', () => {
  it('does not invoke the installer until Harness quiescence', async () => {
    const quiescence = deferred()
    const handoff = deferred()
    const quitAndInstall = vi.fn(() => handoff.promise)
    const actions = fixture({ quiesce: () => quiescence.promise, quitAndInstall })
    const pending = finalizeDesktopShutdown('install', 0, actions)
    let finalized = false
    void pending.then(() => { finalized = true })

    await Promise.resolve()
    expect(actions.quitAndInstall).not.toHaveBeenCalled()
    quiescence.resolve()
    await Promise.resolve()
    expect(actions.quitAndInstall).toHaveBeenCalledOnce()
    expect(finalized).toBe(false)
    handoff.resolve()
    await pending

    expect(finalized).toBe(true)
    expect(actions.quit).not.toHaveBeenCalled()
    expect(actions.exit).not.toHaveBeenCalled()
  })

  it('reports failed quiescence and exits nonzero without invoking the installer', async () => {
    const failure = new Error('application shutdown exceeded 5000ms')
    const actions = fixture({ quiesce: vi.fn(() => Promise.reject(failure)) })

    await finalizeDesktopShutdown('install', 0, actions)

    expect(actions.report).toHaveBeenCalledWith('shutdown', failure)
    expect(actions.exit).toHaveBeenCalledWith(1)
    expect(actions.quitAndInstall).not.toHaveBeenCalled()
    expect(actions.quit).not.toHaveBeenCalled()
  })

  it('preserves a requested nonzero status when quiescence fails', async () => {
    const actions = fixture({ quiesce: vi.fn(() => Promise.reject(new Error('dispose failed'))) })

    await finalizeDesktopShutdown('quit', 7, actions)

    expect(actions.exit).toHaveBeenCalledWith(7)
  })

  it('exits nonzero when the platform installer rejects the handoff', async () => {
    const failure = new Error('installer failed')
    const actions = fixture({ quitAndInstall: vi.fn(async () => { throw failure }) })

    await finalizeDesktopShutdown('install', 0, actions)

    expect(actions.report).toHaveBeenCalledWith('update installation', failure)
    expect(actions.exit).toHaveBeenCalledWith(1)
    expect(actions.quit).not.toHaveBeenCalled()
  })

  it('uses Electron quit for success and exit for a requested failure', async () => {
    const success = fixture()
    await finalizeDesktopShutdown('quit', 0, success)
    expect(success.quit).toHaveBeenCalledOnce()
    expect(success.exit).not.toHaveBeenCalled()

    const failure = fixture()
    await finalizeDesktopShutdown('quit', 2, failure)
    expect(failure.exit).toHaveBeenCalledWith(2)
    expect(failure.quit).not.toHaveBeenCalled()
  })

  it('continues to quiescence and exits nonzero after local cleanup fails', async () => {
    const quiesce = vi.fn(async () => {})
    const laterCleanup = vi.fn()
    const failure = new Error('updater stop failed')
    const actions = fixture({
      cleanup: [() => { throw failure }, laterCleanup],
      quiesce,
    })

    await finalizeDesktopShutdown('install', 0, actions)

    expect(laterCleanup).toHaveBeenCalledOnce()
    expect(quiesce).toHaveBeenCalledOnce()
    expect(actions.report).toHaveBeenCalledWith('cleanup', failure)
    expect(actions.quitAndInstall).not.toHaveBeenCalled()
    expect(actions.exit).toHaveBeenCalledWith(1)
  })

  it('contains cleanup reporting failures and still reaches quiescence', async () => {
    const quiesce = vi.fn(async () => {})
    const actions = fixture({
      cleanup: [() => { throw new Error('cleanup failed') }],
      quiesce,
      report: vi.fn(() => { throw new Error('report failed') }),
    })

    await finalizeDesktopShutdown('install', 0, actions)

    expect(quiesce).toHaveBeenCalledOnce()
    expect(actions.exit).toHaveBeenCalledWith(1)
    expect(actions.quitAndInstall).not.toHaveBeenCalled()
  })

  it('contains shutdown reporting failures and still exits nonzero', async () => {
    const actions = fixture({
      quiesce: vi.fn(() => Promise.reject(new Error('shutdown failed'))),
      report: vi.fn(() => { throw new Error('report failed') }),
    })

    await finalizeDesktopShutdown('quit', 0, actions)

    expect(actions.exit).toHaveBeenCalledWith(1)
  })

  it('contains installer reporting failures and still exits nonzero', async () => {
    const actions = fixture({
      quitAndInstall: vi.fn(async () => { throw new Error('installer failed') }),
      report: vi.fn(() => { throw new Error('report failed') }),
    })

    await finalizeDesktopShutdown('install', 0, actions)

    expect(actions.exit).toHaveBeenCalledWith(1)
  })
})

describe('desktop shutdown request', () => {
  it('keeps the first intent while startup is still in flight', async () => {
    const finalization = deferred()
    const finalize = vi.fn(() => finalization.promise)
    const request = createDesktopShutdownRequest(finalize)
    expect(request.isRequested()).toBe(false)

    const first = request('quit', 7)
    const second = request('install', 0)

    expect(request.isRequested()).toBe(true)
    expect(second).toBe(first)
    expect(finalize).toHaveBeenCalledOnce()
    expect(finalize).toHaveBeenCalledWith('quit', 7)
    finalization.resolve()
    await first
  })

  it('publishes the shared promise before a finalizer can re-enter', async () => {
    let reentered: Promise<void> | undefined
    const finalize = vi.fn(async () => {
      reentered = request('install')
    })
    const request = createDesktopShutdownRequest(finalize)

    const first = request('quit', 7)

    expect(reentered).toBe(first)
    expect(finalize).toHaveBeenCalledOnce()
    expect(finalize).toHaveBeenCalledWith('quit', 7)
    await first
  })
})

describe('desktop failure reporting', () => {
  it('contains a startup diagnostic failure', () => {
    expect(() => {
      reportDesktopFailure(() => { throw new Error('inspect failed') })
    }).not.toThrow()
  })
})

describe('desktop signal shutdown', () => {
  it('preserves SIGINT status through graceful finalization and its fallback', () => {
    const requestShutdown = vi.fn()
    const forceExit = vi.fn()
    const scheduleForceExit = vi.fn()

    handleDesktopSignal(130, {
      shuttingDown: false,
      requestShutdown,
      forceExit,
      scheduleForceExit,
    })

    expect(requestShutdown).toHaveBeenCalledWith(130)
    expect(scheduleForceExit).toHaveBeenCalledWith(130)
    expect(forceExit).not.toHaveBeenCalled()
  })

  it('forces the signal status when another finalization already owns teardown', () => {
    const requestShutdown = vi.fn()
    const forceExit = vi.fn()
    const scheduleForceExit = vi.fn()

    handleDesktopSignal(143, {
      shuttingDown: true,
      requestShutdown,
      forceExit,
      scheduleForceExit,
    })

    expect(forceExit).toHaveBeenCalledWith(143)
    expect(requestShutdown).not.toHaveBeenCalled()
    expect(scheduleForceExit).not.toHaveBeenCalled()
  })
})

describe('desktop profile lifecycle', () => {
  it('routes an exit requested during startup through the attached bounded shutdown', async () => {
    const requestExit = vi.fn()
    const shutdown = { shutdown: vi.fn(async () => {}) }
    const lifecycle = createDesktopProfileLifecycle(requestExit)
    lifecycle.beginBoot()
    lifecycle.profileLifecycle.attach(shutdown)

    lifecycle.profileLifecycle.requestExit(7)
    await lifecycle.quiesce(7)

    expect(requestExit).toHaveBeenCalledWith(7)
    expect(shutdown.shutdown).toHaveBeenCalledWith(7)
  })

  it('allows pre-boot exit but rejects a missing startup attachment', async () => {
    const lifecycle = createDesktopProfileLifecycle(vi.fn())
    await expect(lifecycle.quiesce(0)).resolves.toBeUndefined()

    lifecycle.beginBoot()
    await expect(lifecycle.quiesce(0)).rejects.toThrow('desktop profile shutdown was not attached')
  })

  it('rejects replacement of the attached shutdown owner', () => {
    const lifecycle = createDesktopProfileLifecycle(vi.fn())
    const first = { shutdown: vi.fn(async () => {}) }
    lifecycle.profileLifecycle.attach(first)
    lifecycle.profileLifecycle.attach(first)

    expect(() => {
      lifecycle.profileLifecycle.attach({ shutdown: vi.fn(async () => {}) })
    }).toThrow('desktop profile shutdown was attached more than once')
  })
})
