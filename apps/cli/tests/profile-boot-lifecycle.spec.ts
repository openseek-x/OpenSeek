import { describe, expect, it, vi } from 'vitest'
import type { FailLoudProcess } from '@deepseek-ai/dsh-app-boot'
import { installProfileFailLoud, type ProfileLifecycle } from '../src/profile-boot.ts'

interface TriggerableProcess extends FailLoudProcess {
  readonly exits: number[]
  readonly written: string[]
  reject(error: unknown): void
}

function triggerableProcess(): TriggerableProcess {
  const handlers = new Set<(error: unknown) => void>()
  const exits: number[] = []
  const written: string[] = []
  return {
    exits,
    written,
    on(_event, handler) {
      handlers.add(handler)
    },
    off(_event, handler) {
      handlers.delete(handler)
    },
    stderr: {
      write(chunk) {
        written.push(chunk)
      },
    },
    exit(code) {
      exits.push(code)
    },
    reject(error) {
      for (const handler of handlers) handler(error)
    },
  }
}

describe('profile fatal rejection lifecycle', () => {
  it('routes caller-owned fatal completion directly to its lifecycle owner', () => {
    const proc = triggerableProcess()
    const requestExit = vi.fn()
    const release = vi.fn(async () => {})
    const lifecycle: ProfileLifecycle = {
      kind: 'caller',
      attach: vi.fn(),
      requestExit,
    }
    const uninstall = installProfileFailLoud(lifecycle, proc, release)
    const failure = new Error('desktop plugin failed')

    proc.reject(failure)

    expect(proc.written).toHaveLength(1)
    expect(proc.written[0]).toContain(failure.message)
    expect(proc.exits).toEqual([])
    expect(requestExit).toHaveBeenCalledWith(1)
    expect(release).not.toHaveBeenCalled()
    uninstall()
  })

  it('preserves process-owned release and exit', async () => {
    const proc = triggerableProcess()
    const release = vi.fn(async () => {})
    const uninstall = installProfileFailLoud({ kind: 'process' }, proc, release)

    proc.reject(new Error('cli plugin failed'))

    await vi.waitFor(() => { expect(proc.exits).toEqual([1]) })
    expect(release).toHaveBeenCalledOnce()
    uninstall()
  })
})
