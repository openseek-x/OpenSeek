/** Smoke-test the packaged desktop application through local CDP endpoints. */

import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { arch, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const targetArch = arch() === 'x64' ? 'x64' : arch() === 'arm64' ? 'arm64' : undefined
if (targetArch === undefined) throw new Error(`desktop smoke: unsupported architecture ${arch()}`)
if (!['darwin', 'win32', 'linux'].includes(process.platform)) {
  throw new Error(`desktop smoke: unsupported platform ${process.platform}`)
}
const platformDirectory = join(
  repositoryRoot,
  'dist-desktop',
  `${process.platform === 'linux' ? 'DeepSeek-Harness' : 'DeepSeek Harness'}-${process.platform}-${targetArch}`,
)
const executable = process.platform === 'darwin'
  ? join(platformDirectory, 'DeepSeek Harness.app', 'Contents/MacOS/DeepSeek Harness')
  : process.platform === 'win32'
    ? join(platformDirectory, 'DeepSeek Harness.exe')
    : join(platformDirectory, 'deepseek-harness')
const companionCli = process.platform === 'darwin'
  ? join(platformDirectory, 'DeepSeek Harness.app', 'Contents/MacOS/dsh')
  : process.platform === 'win32'
    ? join(platformDirectory, 'dsh.cmd')
    : join(platformDirectory, 'dsh')
const STARTUP_TIMEOUT_MS = 60_000
const SHUTDOWN_TIMEOUT_MS = 5_000
const WINDOWS_COMPANION_BUNDLE_ENV = 'DSH_DESKTOP_COMPANION_BUNDLE'
const WINDOWS_COMPANION_EXECUTABLE_ENV = 'DSH_DESKTOP_COMPANION_EXECUTABLE'

interface DebugPage {
  title: string
  url: string
  webSocketDebuggerUrl: string
}

/** Poll one asynchronous observation until it returns a value. */
async function waitFor<T>(
  read: () => Promise<T | undefined> | T | undefined,
  description: string,
): Promise<T> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  }
  throw new Error(`desktop smoke timed out waiting for ${description}`)
}

/** Evaluate one expression through a selected CDP endpoint. */
async function evaluate(
  webSocketDebuggerUrl: string,
  expression: string,
  timeoutMs = STARTUP_TIMEOUT_MS,
): Promise<unknown> {
  return await new Promise((resolveEvaluation, rejectEvaluation) => {
    const socket = new WebSocket(webSocketDebuggerUrl)
    const timeout = setTimeout(() => {
      socket.close()
      rejectEvaluation(new Error('desktop smoke timed out waiting for a CDP evaluation'))
    }, timeoutMs)
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }))
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number
        error?: { message?: string }
        result?: {
          exceptionDetails?: { exception?: { description?: string }; text?: string }
          result?: { value?: unknown }
        }
      }
      if (message.id !== 1) return
      clearTimeout(timeout)
      socket.close()
      if (message.error !== undefined) {
        rejectEvaluation(new Error(message.error.message ?? 'desktop smoke CDP evaluation failed'))
      } else if (message.result?.exceptionDetails !== undefined) {
        rejectEvaluation(new Error(
          message.result.exceptionDetails.exception?.description
          ?? message.result.exceptionDetails.text
          ?? 'desktop smoke CDP evaluation threw',
        ))
      } else {
        resolveEvaluation(message.result?.result?.value)
      }
    })
    socket.addEventListener('error', () => {
      clearTimeout(timeout)
      rejectEvaluation(new Error('desktop smoke could not connect to the CDP endpoint'))
    })
  })
}

/** Wait for the packaged process and its captured output streams to close. */
async function waitForClose(closed: Promise<void>, timeoutMs: number): Promise<boolean> {
  return await new Promise((resolveExit) => {
    const exited = (): void => {
      clearTimeout(timeout)
      resolveExit(true)
    }
    const timeout = setTimeout(() => {
      resolveExit(false)
    }, timeoutMs)
    void closed.then(exited)
  })
}

if (!existsSync(executable)) throw new Error(`desktop smoke: package first; missing ${executable}`)
if (!existsSync(companionCli)) throw new Error(`desktop smoke: packaged companion CLI is missing: ${companionCli}`)

const cliHome = mkdtempSync(join(tmpdir(), 'dsh-desktop-cli-smoke-'))
try {
  let companionCommand = companionCli
  if (process.platform !== 'win32') {
    const linkDirectory = join(cliHome, 'bin')
    mkdirSync(linkDirectory)
    companionCommand = join(linkDirectory, 'dsh')
    symlinkSync(companionCli, companionCommand)
  }
  const bundle = resolve(cliHome, 'smoke-bundle')
  mkdirSync(bundle)
  writeFileSync(join(bundle, 'package.json'), `${JSON.stringify({
    name: 'dsh-desktop-smoke-bundle',
    version: '1.0.0',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, undefined, 2)}\n`)
  writeFileSync(join(bundle, 'cordis.patch.yml'), '[]\n')
  const cliEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    CI: 'true',
    DSH_HOME: cliHome,
    // The companion must use Electron's Node runtime and its bundled pnpm,
    // not accidentally pass because the build host provides either command.
    PATH: '',
  }
  let companionExecutable = companionCommand
  let companionPrefixArgs: string[] = []
  if (process.platform === 'win32') {
    const commandProcessor = process.env.ComSpec
    if (commandProcessor === undefined || commandProcessor.length === 0) {
      throw new Error('desktop smoke: Windows ComSpec is missing')
    }
    if (!isAbsolute(commandProcessor) || basename(commandProcessor).toLowerCase() !== 'cmd.exe') {
      throw new Error(`desktop smoke: Windows ComSpec must be an absolute cmd.exe path: ${commandProcessor}`)
    }
    companionExecutable = commandProcessor
    companionPrefixArgs = ['/d', '/v:off', '/s', '/c', `%${WINDOWS_COMPANION_EXECUTABLE_ENV}%`]
    // cmd.exe must expand quoted dynamic paths after parsing its own command line.
    cliEnvironment[WINDOWS_COMPANION_BUNDLE_ENV] = `"${bundle}"`
    cliEnvironment[WINDOWS_COMPANION_EXECUTABLE_ENV] = `"${companionCommand}"`
  }
  const runCompanion = (args: string[]): string => {
    const result = spawnSync(companionExecutable, [...companionPrefixArgs, ...args], {
      encoding: 'utf8',
      env: cliEnvironment,
      killSignal: 'SIGKILL',
      timeout: STARTUP_TIMEOUT_MS,
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) {
      throw new Error(
        `desktop smoke: companion ${args.join(' ')} failed (${String(result.status)}): ${result.stderr}`,
      )
    }
    return result.stdout.trim()
  }
  const version = runCompanion(['--version'])
  if (version === '') throw new Error('desktop smoke: companion CLI printed no version')
  const bundleArgument = process.platform === 'win32' ? `%${WINDOWS_COMPANION_BUNDLE_ENV}%` : bundle
  runCompanion(['plugin', '--profile', 'desktop-smoke', 'add', bundleArgument])
  const nodeVersion = runCompanion(['plugin', '--profile', 'desktop-smoke', 'exec', 'node', '--version'])
  const pnpmVersion = runCompanion(['plugin', '--profile', 'desktop-smoke', 'exec', 'pnpm', '--version'])
  if (!/^v\d+\./.test(nodeVersion)) throw new Error(`desktop smoke: invalid embedded Node version: ${nodeVersion}`)
  if (!/^\d+\.\d+\./.test(pnpmVersion)) throw new Error(`desktop smoke: invalid pinned pnpm version: ${pnpmVersion}`)
  const profileManifest = JSON.parse(
    readFileSync(join(cliHome, 'profiles', 'desktop-smoke', 'package.json'), 'utf8'),
  ) as { dsh?: { profile?: { bundles?: unknown } } }
  const bundles = profileManifest.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || !bundles.includes('dsh-desktop-smoke-bundle')) {
    throw new Error('desktop smoke: companion plugin install did not activate its profile bundle')
  }
  console.log(
    `desktop smoke: companion CLI ${version} installed a local profile bundle with ${nodeVersion} / pnpm ${pnpmVersion}`,
  )
} finally {
  rmSync(cliHome, { recursive: true, force: true })
}

let output = ''
let debugPort: number | undefined
let ready = false
let testFailure: Error | undefined
let mainWebSocketDebuggerUrl: string | undefined
const userDataDirectory = mkdtempSync(join(tmpdir(), 'dsh-desktop-smoke-user-data-'))
const child = spawn(executable, [
  '--inspect=0',
  '--remote-debugging-port=0',
  `--user-data-dir=${userDataDirectory}`,
], {
  cwd: repositoryRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
})
const childClosed = new Promise<void>((resolveClosed) => {
  child.once('close', () => { resolveClosed() })
})
const capture = (chunk: Buffer): void => {
  output += chunk.toString('utf8')
  ready ||= output.includes('dsh desktop: ready')
  const browserMatch = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(output)
  if (browserMatch?.[1] !== undefined) debugPort = Number(browserMatch[1])
  const mainMatch = /Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/.exec(output)
  if (mainMatch?.[1] !== undefined) mainWebSocketDebuggerUrl = mainMatch[1]
}
child.stdout.on('data', capture)
child.stderr.on('data', capture)

try {
  const port = await waitFor(() => {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`desktop smoke exited during startup (${String(child.exitCode ?? child.signalCode)})`)
    }
    return ready && mainWebSocketDebuggerUrl !== undefined ? debugPort : undefined
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
      'JSON.stringify({ title: document.title, body: document.body?.innerText })',
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
  const updateState = await waitFor(async () => {
    const current = await evaluate(page.webSocketDebuggerUrl, `void 0; (async () => {
      const bridge = globalThis.dshDesktopUpdate
      if (typeof bridge?.getState !== 'function'
        || typeof bridge?.act !== 'function'
        || typeof bridge?.onState !== 'function') return undefined
      const unsubscribe = bridge.onState(() => undefined)
      if (typeof unsubscribe !== 'function') return undefined
      unsubscribe()
      const state = await bridge.getState()
      return JSON.stringify(state)
    })()`)
    if (typeof current !== 'string') return undefined
    const state = JSON.parse(current) as { currentVersion?: unknown; revision?: unknown; status?: unknown }
    return typeof state.currentVersion === 'string'
      && typeof state.revision === 'number'
      && typeof state.status === 'string'
      ? state
      : undefined
  }, 'the context-isolated desktop update bridge')
  console.log(
    `desktop smoke: ready at ${page.url}; rendered ${String(rendered.body.trim().length)} characters; updater ${String(updateState.status)}`,
  )
} catch (error) {
  testFailure = error instanceof Error
    ? error
    : new Error('desktop smoke failed with a non-Error rejection')
  console.error(output)
} finally {
  const running = child.exitCode === null && child.signalCode === null
  let gracefulShutdownRequested = false
  let shutdownStartedAt = Date.now()
  if (running) {
    try {
      shutdownStartedAt = Date.now()
      if (mainWebSocketDebuggerUrl === undefined) {
        throw new Error('desktop smoke has no main-process debugger endpoint for graceful shutdown')
      }
      const handled = await evaluate(mainWebSocketDebuggerUrl, "process.emit('SIGTERM')", SHUTDOWN_TIMEOUT_MS)
      if (handled !== true) throw new Error('desktop smoke main process did not handle SIGTERM')
      gracefulShutdownRequested = true
    } catch (error) {
      testFailure ??= error instanceof Error
        ? error
        : new Error('desktop smoke could not request graceful shutdown')
    }
  } else {
    testFailure ??= new Error('desktop smoke: packaged application exited before graceful shutdown')
  }

  const remainingMs = Math.max(0, SHUTDOWN_TIMEOUT_MS - (Date.now() - shutdownStartedAt))
  const exited = gracefulShutdownRequested && await waitForClose(childClosed, remainingMs)
  if (!exited) {
    if (gracefulShutdownRequested) {
      testFailure ??= new Error(
        `desktop smoke: packaged application did not exit within ${String(SHUTDOWN_TIMEOUT_MS)}ms`,
      )
    }
    child.kill('SIGKILL')
    if (!(await waitForClose(childClosed, SHUTDOWN_TIMEOUT_MS))) {
      testFailure ??= new Error('desktop smoke: packaged application could not be cleaned up')
    }
  } else if (child.exitCode !== 0 || child.signalCode !== null) {
    testFailure ??= new Error(
      `desktop smoke: packaged application shutdown was not clean (exitCode=${String(child.exitCode)}, signal=${String(child.signalCode)})`,
    )
  } else if (!output.includes('dsh desktop: shutdown quiesced')) {
    testFailure ??= new Error('desktop smoke: packaged application bypassed coordinated shutdown')
  }
  rmSync(userDataDirectory, { recursive: true, force: true })
}

if (testFailure !== undefined) throw testFailure
