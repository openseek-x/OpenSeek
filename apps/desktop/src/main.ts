/** Electron main process for the local DeepSeek Harness desktop surface. */

import { createWriteStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile, type RunProfileOptions } from '@deepseek-ai/dsh/profile-boot'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { injectBootManifest, type ClientModuleRegistry } from '@deepseek-ai/dsh-client-modules'
import {
  IPC_FETCH,
  IPC_FETCH_CANCEL,
  IPC_SAVE_DOWNLOAD,
  IPC_STREAM_CANCEL,
  IPC_STREAM_EVENT,
  IPC_STREAM_OPEN,
  MAX_REQUEST_BODY_BYTES,
  type IpcDownloadRequest,
  type IpcRequest,
  type IpcResponse,
  type IpcStreamEvent,
} from './ipc.ts'

protocol.registerSchemesAsPrivileged([{
  scheme: 'dsh',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
}])

const APP_ORIGIN = 'dsh://app'
const APP_URL = `${APP_ORIGIN}/`
const CSP = [
  "default-src 'self' data: blob:",
  // The shipped web bundle compiles Cordis config expressions dynamically.
  // Scope eval to this isolated custom origin; navigation and remote scripts
  // remain blocked by the remaining directives and BrowserWindow policy.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
].join('; ')

let window: BrowserWindow | undefined
let connection: HostConnectionHandle | undefined
let modules: ClientModuleRegistry | undefined
let shutdown: Awaited<ReturnType<typeof runProfile>>['shutdown'] | undefined
let quitting = false

const requests = new Map<string, AbortController>()
const streams = new Map<string, AbortController>()

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function safeRequest(value: unknown): IpcRequest {
  if (typeof value !== 'object' || value === null) throw new TypeError('desktop IPC request must be an object')
  const candidate = value as Partial<IpcRequest>
  if (typeof candidate.id !== 'string' || candidate.id.length > 128) throw new TypeError('desktop IPC request id is invalid')
  if (typeof candidate.url !== 'string' || typeof candidate.method !== 'string' || !Array.isArray(candidate.headers)) {
    throw new TypeError('desktop IPC request metadata is invalid')
  }
  const url = new URL(candidate.url)
  if (url.protocol !== 'dsh:' || url.host !== 'app') throw new TypeError('desktop IPC request URL is outside the application origin')
  if (!candidate.headers.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string'))) {
    throw new TypeError('desktop IPC request headers are invalid')
  }
  if (candidate.body !== undefined && (!(candidate.body instanceof Uint8Array) || candidate.body.byteLength > MAX_REQUEST_BODY_BYTES)) {
    throw new TypeError('desktop IPC request body is invalid or exceeds the carrier limit')
  }
  return candidate as IpcRequest
}

function requestOf(value: unknown, signal: AbortSignal): Request {
  const request = safeRequest(value)
  const method = request.method.toUpperCase()
  if (!/^[A-Z]+$/.test(method)) throw new TypeError('desktop IPC request method is invalid')
  if ((method === 'GET' || method === 'HEAD') && request.body !== undefined) {
    throw new TypeError(`${method} request cannot carry a body`)
  }
  return new Request(request.url, {
    method,
    headers: request.headers,
    ...request.body === undefined ? {} : { body: Uint8Array.from(request.body).buffer },
    signal,
  })
}

function assertRenderer(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const owner = window
  const frame = event.senderFrame
  if (owner === undefined
    || event.sender !== owner.webContents
    || frame === null
    || frame.parent !== null) {
    throw new Error('desktop IPC rejected a non-main-frame sender')
  }
  const senderUrl = new URL(frame.url)
  if (senderUrl.protocol !== 'dsh:' || senderUrl.host !== 'app') throw new Error('desktop IPC rejected an untrusted origin')
}

async function serializeResponse(response: Response): Promise<IpcResponse> {
  const body = new Uint8Array(await response.arrayBuffer())
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    body,
  }
}

function emitStream(event: IpcMainEvent, payload: IpcStreamEvent): void {
  if (!event.sender.isDestroyed()) event.sender.send(IPC_STREAM_EVENT, payload)
}

function registerIpc(): void {
  ipcMain.handle(IPC_FETCH, async (event, value: unknown) => {
    if (quitting) {
      return {
        status: 503,
        statusText: 'Service Unavailable',
        headers: [['content-type', 'text/plain; charset=utf-8']],
        body: new TextEncoder().encode('desktop host is shutting down'),
      } satisfies IpcResponse
    }
    assertRenderer(event)
    const id = typeof value === 'object' && value !== null ? (value as { id?: unknown }).id : undefined
    if (typeof id !== 'string') throw new TypeError('desktop IPC request id is missing')
    if (requests.has(id)) throw new Error(`duplicate desktop request id ${id}`)
    const abort = new AbortController()
    requests.set(id, abort)
    try {
      const active = connection
      if (active === undefined) throw new Error('desktop host is not ready')
      return await serializeResponse(await active.fetch(requestOf(value, abort.signal)))
    } finally {
      requests.delete(id)
    }
  })

  ipcMain.on(IPC_FETCH_CANCEL, (event, id: unknown) => {
    if (quitting) return
    assertRenderer(event)
    if (typeof id === 'string') requests.get(id)?.abort()
  })

  ipcMain.on(IPC_STREAM_OPEN, (event, value: unknown) => {
    if (quitting) return
    assertRenderer(event)
    const id = typeof value === 'object' && value !== null ? (value as { id?: unknown }).id : undefined
    if (typeof id !== 'string') return
    if (streams.has(id)) {
      emitStream(event, { id, kind: 'error', message: `duplicate desktop stream id ${id}` })
      return
    }
    const abort = new AbortController()
    streams.set(id, abort)
    void (async () => {
      try {
        const active = connection
        if (active === undefined) throw new Error('desktop host is not ready')
        const response = await active.fetch(requestOf(value, abort.signal))
        emitStream(event, {
          id,
          kind: 'opened',
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers.entries()],
        })
        if (response.body !== null) {
          for await (const chunk of response.body) emitStream(event, { id, kind: 'data', chunk })
        }
        emitStream(event, { id, kind: 'end' })
      } catch (error) {
        if (!abort.signal.aborted) emitStream(event, { id, kind: 'error', message: messageOf(error) })
      } finally {
        streams.delete(id)
      }
    })()
  })

  ipcMain.on(IPC_STREAM_CANCEL, (event, id: unknown) => {
    if (quitting) return
    assertRenderer(event)
    if (typeof id === 'string') streams.get(id)?.abort()
  })

  ipcMain.handle(IPC_SAVE_DOWNLOAD, async (event, value: unknown) => {
    if (quitting) return
    assertRenderer(event)
    if (typeof value !== 'object' || value === null) throw new TypeError('desktop download request must be an object')
    const request = value as Partial<IpcDownloadRequest>
    if (typeof request.id !== 'string' || typeof request.path !== 'string' || typeof request.filename !== 'string') {
      throw new TypeError('desktop download request is invalid')
    }
    const url = new URL(request.path, APP_ORIGIN)
    if (url.protocol !== 'dsh:' || url.host !== 'app' || !url.pathname.startsWith('/api/')) {
      throw new TypeError('desktop download path is outside the Host API')
    }
    const filename = basename(request.filename)
    if (filename !== request.filename || filename === '.' || filename === '..') throw new TypeError('desktop download filename is invalid')
    const owner = window
    if (owner === undefined) throw new Error('desktop window is not available')
    const result = await dialog.showSaveDialog(owner, { defaultPath: filename })
    if (result.canceled || result.filePath === undefined) return
    const active = connection
    if (active === undefined) throw new Error('desktop host is not ready')
    const abort = new AbortController()
    if (requests.has(request.id)) throw new Error(`duplicate desktop request id ${request.id}`)
    requests.set(request.id, abort)
    try {
      const response = await active.fetch(new Request(url, { signal: abort.signal }))
      if (!response.ok || response.body === null) throw new Error(`download failed: HTTP ${String(response.status)}`)
      await pipeline(
        Readable.from(response.body as AsyncIterable<Uint8Array>),
        createWriteStream(result.filePath, { flags: 'w' }),
      )
    } finally {
      requests.delete(request.id)
    }
  })
}

function responseHeaders(contentType: string): HeadersInit {
  return {
    'content-type': contentType,
    'content-security-policy': CSP,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
  }
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json':
    case '.webmanifest': return 'application/json; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.woff2': return 'font/woff2'
    default: return 'application/octet-stream'
  }
}

function resolveFrontendIndex(): string {
  const require = createRequire(import.meta.url)
  try {
    return require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')
  } catch {
    throw new Error('desktop: frontend dist not built; run pnpm run build from the repository root first')
  }
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

async function fileResponse(path: string, method: string): Promise<Response | undefined> {
  try {
    if (!(await stat(path)).isFile()) return undefined
    return new Response(method === 'HEAD' ? null : await readFile(path), {
      headers: responseHeaders(contentType(path)),
    })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

async function serveApplication(request: Request, distIndex: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 })
  const url = new URL(request.url)
  if (url.host !== 'app') return new Response('not found', { status: 404 })
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return new Response('bad request', { status: 400 })
  }
  const pluginPrefix = '/plugins/'
  const pluginSuffix = '/client.js'
  if (pathname.startsWith(pluginPrefix) && pathname.endsWith(pluginSuffix)) {
    const id = pathname.slice(pluginPrefix.length, -pluginSuffix.length)
    const bundle = modules?.clientPath(id)
    if (bundle === undefined) return new Response('not found', { status: 404 })
    return await fileResponse(bundle, request.method) ?? new Response('not found', { status: 404 })
  }
  const distRoot = dirname(distIndex)
  const relativePath = pathname.replace(/^\/+/, '')
  const candidate = resolve(distRoot, relativePath)
  if (!inside(distRoot, candidate)) return new Response('forbidden', { status: 403 })
  if (relativePath !== '') {
    const file = await fileResponse(candidate, request.method)
    if (file !== undefined) return file
  }
  const html = injectBootManifest(await readFile(distIndex, 'utf8'), modules?.graph() ?? { rev: '', entries: [] })
  return new Response(request.method === 'HEAD' ? null : html, { headers: responseHeaders('text/html; charset=utf-8') })
}

function registerDesktopSurface(): void {
  const distIndex = resolveFrontendIndex()
  protocol.handle('dsh', request => serveApplication(request, distIndex))
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
}

function createWindow(): BrowserWindow {
  const created = new BrowserWindow({
    title: 'DeepSeek Harness',
    // Let the renderer reach the top edge on macOS while keeping the native
    // close/minimize/zoom controls. The document title remains available to
    // the app switcher and accessibility APIs without painting a title strip.
    ...process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {},
    width: 1380,
    height: 900,
    minWidth: 920,
    minHeight: 640,
    show: false,
    backgroundColor: '#111318',
    webPreferences: {
      preload: fileURLToPath(new URL('../lib/preload.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  created.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (target.protocol === 'https:' || target.protocol === 'http:') void shell.openExternal(target.toString())
    } catch { /* malformed targets stay denied */ }
    return { action: 'deny' }
  })
  created.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url)
      if (target.protocol === 'dsh:' && target.host === 'app') return
    } catch { /* malformed targets stay blocked */ }
    event.preventDefault()
  })
  created.once('ready-to-show', () => { created.show() })
  created.on('closed', () => { if (window === created) window = undefined })
  void created.loadURL(APP_URL)
  return created
}

async function bootDesktop(): Promise<void> {
  // Finder launches packaged applications with `/` as cwd. Keep terminal
  // launches attached to their caller, but give Finder launches a useful and
  // bounded initial workspace instead of exposing the filesystem root.
  if (app.isPackaged && process.cwd() === '/') process.chdir(app.getPath('documents'))
  const options: RunProfileOptions = {
    environment: loadLayeredEnv('dsh-desktop'),
    profile: 'web',
    patchFiles: [fileURLToPath(new URL('../config/desktop.patch.yml', import.meta.url))],
    args: [],
    watchConfig: false,
    handleSignals: false,
  }
  console.log('dsh desktop: booting profile')
  const result = await runProfile(options)
  console.log('dsh desktop: profile ready')
  shutdown = result.shutdown
  connection = result.ctx.get('connection') as HostConnectionHandle | undefined
  modules = result.ctx.get('clientModules') as ClientModuleRegistry | undefined
  if (connection === undefined || modules === undefined) throw new Error('desktop: Connection or clientModules failed to mount')
  console.log('dsh desktop: context ready')
  registerDesktopSurface()
  registerIpc()
  window = createWindow()
  console.log('dsh desktop: ready')
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (window === undefined && connection !== undefined) window = createWindow()
})

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  for (const request of requests.values()) request.abort()
  for (const stream of streams.values()) stream.abort()
  if (shutdown === undefined) {
    app.quit()
    return
  }
  void shutdown.shutdown(0).finally(() => { app.quit() })
})

process.once('SIGINT', () => {
  if (quitting) {
    app.exit(130)
    return
  }
  app.quit()
  setTimeout(() => { app.exit(130) }, 7_000).unref()
})
process.once('SIGTERM', () => {
  if (quitting) {
    app.exit(0)
    return
  }
  app.quit()
  setTimeout(() => { app.exit(0) }, 7_000).unref()
})

await app.whenReady()
try {
  await bootDesktop()
} catch (error) {
  console.error('dsh desktop: startup failed:', inspect(error, { depth: Number.POSITIVE_INFINITY }))
  dialog.showErrorBox('DeepSeek Harness could not start', messageOf(error))
  app.exit(1)
}
