/** Smoke-test the packaged macOS desktop application through Chromium's CDP endpoint. */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { arch } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const targetArch = arch() === 'x64' ? 'x64' : 'arm64'
const appPath = join(
  repositoryRoot,
  'dist-desktop',
  `DeepSeek Harness-darwin-${targetArch}`,
  'DeepSeek Harness.app',
)
const executable = join(appPath, 'Contents/MacOS/DeepSeek Harness')
const STARTUP_TIMEOUT_MS = 30_000

interface DebugPage {
  title: string
  url: string
  webSocketDebuggerUrl: string
}

/** Poll one asynchronous observation until it returns a value. */
async function waitFor<T>(read: () => Promise<T | undefined>, description: string): Promise<T> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  }
  throw new Error(`desktop smoke timed out waiting for ${description}`)
}

/** Evaluate one expression in the selected renderer through CDP. */
async function evaluate(webSocketDebuggerUrl: string, expression: string): Promise<unknown> {
  return await new Promise((resolveEvaluation, rejectEvaluation) => {
    const socket = new WebSocket(webSocketDebuggerUrl)
    const timeout = setTimeout(() => {
      socket.close()
      rejectEvaluation(new Error('desktop smoke timed out waiting for a renderer evaluation'))
    }, STARTUP_TIMEOUT_MS)
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true },
      }))
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number
        error?: { message?: string }
        result?: { result?: { value?: unknown } }
      }
      if (message.id !== 1) return
      clearTimeout(timeout)
      socket.close()
      if (message.error !== undefined) {
        rejectEvaluation(new Error(message.error.message ?? 'desktop smoke renderer evaluation failed'))
      } else {
        resolveEvaluation(message.result?.result?.value)
      }
    })
    socket.addEventListener('error', () => {
      clearTimeout(timeout)
      rejectEvaluation(new Error('desktop smoke could not connect to the renderer endpoint'))
    })
  })
}

/** Wait for the packaged process to exit within a bounded interval. */
async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true
  return await new Promise((resolveExit) => {
    const exited = (): void => {
      clearTimeout(timeout)
      resolveExit(true)
    }
    const timeout = setTimeout(() => {
      child.off('exit', exited)
      resolveExit(false)
    }, timeoutMs)
    child.once('exit', exited)
    // The process can exit after the caller's first check but before this
    // listener is installed. Recheck only after both completion paths exist.
    if (child.exitCode !== null || child.signalCode !== null) {
      child.off('exit', exited)
      clearTimeout(timeout)
      resolveExit(true)
    }
  })
}

if (process.platform !== 'darwin') throw new Error('desktop smoke currently supports macOS only')
if (!existsSync(executable)) throw new Error(`desktop smoke: package first; missing ${appPath}`)

let output = ''
let debugPort: number | undefined
let ready = false
let testFailure: unknown
const child = spawn(executable, ['--remote-debugging-port=0'], {
  cwd: repositoryRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
})
const capture = (chunk: Buffer): void => {
  output += chunk.toString('utf8')
  ready ||= output.includes('dsh desktop: ready')
  const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(output)
  if (match?.[1] !== undefined) debugPort = Number(match[1])
}
child.stdout?.on('data', capture)
child.stderr?.on('data', capture)

try {
  const port = await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`desktop smoke exited during startup (${String(child.exitCode)})`)
    return ready ? debugPort : undefined
  }, 'the packaged application')
  const page = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/json/list`)
      if (!response.ok) return undefined
      const pages = await response.json() as DebugPage[]
      return pages.find(candidate => candidate.url === 'dsh://app/')
    } catch { /* the local debugging endpoint is not listening yet */ }
    return undefined
  }, 'the dsh://app/ renderer')
  const rendered = await waitFor(async () => {
    const current = await evaluate(
      page.webSocketDebuggerUrl,
      'JSON.stringify({ title: document.title, body: document.body.innerText })',
    )
    if (typeof current !== 'string') return undefined
    const state = JSON.parse(current) as { title?: unknown; body?: unknown }
    const hasApplicationTitle = state.title === 'DeepSeek Harness'
      || (typeof state.title === 'string' && state.title.endsWith(' — DeepSeek Harness'))
    return hasApplicationTitle
      && typeof state.body === 'string'
      && !state.body.includes('Loading plugins')
      && state.body.trim().length >= 40
      ? { title: state.title, body: state.body }
      : undefined
  }, 'the composed desktop interface')
  console.log(`desktop smoke: ready at ${page.url}; rendered ${String(rendered.body.trim().length)} characters`)
} catch (error) {
  testFailure = error
  console.error(output)
} finally {
  child.kill('SIGINT')
  if (!(await waitForExit(child, 10_000))) {
    child.kill('SIGKILL')
    await waitForExit(child, 5_000)
    testFailure ??= new Error('desktop smoke: packaged application did not exit after SIGINT')
  }
}

if (testFailure !== undefined) throw testFailure
