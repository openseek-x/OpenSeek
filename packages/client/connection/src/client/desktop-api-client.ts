/** Desktop transport: reconstruct unary and Remote-stream carriers from the context-isolated preload bridge. */

import { randomUuid } from './random-uuid.ts'
import type { RpcFetch, RpcStreamOpen } from './rpc.ts'
import type {
  DesktopConnectionBridge,
  DesktopRequest,
  DesktopResponse,
  DesktopStreamRequest,
  DesktopStreamSink,
} from '../rpc.ts'

/** Transport hooks supplied to the generic Connection browser plugin by an Electron renderer. */
export interface DesktopTransport {
  /** Context-isolated unary RPC carrier. */
  readonly fetch: RpcFetch
  /** Context-isolated, direct Host Remote-stream carrier. */
  readonly openStream: RpcStreamOpen
  /** The Electron main process owns the only Host instance. */
  readonly ownsHost: true
}

/**
 * Build the browser-transport hooks for the Electron preload bridge.
 * @param bridge - validated context-isolated desktop bridge.
 * @returns unary and stream transports that never expose Electron APIs to page code.
 */
export function createDesktopTransport(bridge: DesktopConnectionBridge): DesktopTransport {
  return {
    fetch: (input, init) => desktopFetch(bridge, input, init),
    openStream: (endpoint, payload, signal) => desktopStream(bridge, endpoint, payload, signal),
    ownsHost: true,
  }
}

async function desktopFetch(
  bridge: DesktopConnectionBridge,
  input: URL,
  init?: RequestInit,
): Promise<Response> {
  const request = await serializeRequest(input, init)
  return await unary(bridge, request, init?.signal ?? null)
}

async function unary(
  bridge: DesktopConnectionBridge,
  request: DesktopRequest,
  signal: AbortSignal | null,
): Promise<Response> {
  if (signal === null) return responseOf(await bridge.request(request))
  throwAbortErrorIfAborted(signal)
  const onAbort = (): void => { bridge.cancelRequest(request.id) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await bridge.request(request)
    throwAbortErrorIfAborted(signal)
    return responseOf(response)
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

async function* desktopStream(
  bridge: DesktopConnectionBridge,
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
): AsyncGenerator<unknown> {
  signal.throwIfAborted()
  const request: DesktopStreamRequest = { id: randomUuid(), endpoint, payload }
  const queue = new StreamQueue<unknown>()
  let cancelled = false
  const cancel = (): void => {
    if (cancelled) return
    cancelled = true
    bridge.cancelStream(request.id)
  }
  const onAbort = (): void => {
    cancel()
    queue.fail(abortError(signal))
  }
  const sink: DesktopStreamSink = {
    data: (value) => { queue.push(value) },
    end: () => { queue.end() },
    error: (message) => { queue.fail(new Error(message)) },
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    bridge.openStream(request, sink)
    while (true) {
      const next = await queue.next()
      if (next.done) return
      yield next.value
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
    cancel()
  }
}

/** Single-consumer async queue backing one Remote-stream IPC registration. */
class StreamQueue<T> {
  private readonly values: T[] = []
  private waiter: {
    resolve(value: IteratorResult<T>): void
    reject(reason?: unknown): void
  } | undefined
  private failure: unknown | undefined
  private ended = false

  push(value: T): void {
    if (this.ended || this.failure !== undefined) return
    const waiter = this.waiter
    if (waiter !== undefined) {
      this.waiter = undefined
      waiter.resolve({ done: false, value })
      return
    }
    this.values.push(value)
  }

  end(): void {
    if (this.ended || this.failure !== undefined) return
    this.ended = true
    const waiter = this.waiter
    if (waiter !== undefined) {
      this.waiter = undefined
      waiter.resolve({ done: true, value: undefined })
    }
  }

  fail(error: unknown): void {
    if (this.ended || this.failure !== undefined) return
    this.failure = error
    this.values.length = 0
    const waiter = this.waiter
    if (waiter !== undefined) {
      this.waiter = undefined
      waiter.reject(error)
    }
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift()
    if (value !== undefined) return Promise.resolve({ done: false, value })
    if (this.failure !== undefined) return Promise.reject(this.failure)
    if (this.ended) return Promise.resolve({ done: true, value: undefined })
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiter = { resolve, reject }
    })
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError')
}

/** Throw the normalized AbortError after an asynchronous operation observes cancellation. */
function throwAbortErrorIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal)
}

function responseOf(response: DesktopResponse): Response {
  return new Response(Uint8Array.from(response.body).buffer, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

async function serializeRequest(input: URL, init: RequestInit | undefined): Promise<DesktopRequest> {
  const url = new URL(input.toString())
  if (url.protocol !== 'dsh:' || url.host !== 'app') throw new TypeError('desktop carrier only accepts dsh://app URLs')
  const body = await bodyBytes(init?.body)
  return {
    id: randomUuid(),
    url: url.toString(),
    method: (init?.method ?? 'GET').toUpperCase(),
    headers: [...new Headers(init?.headers).entries()],
    ...body === undefined ? {} : { body },
  }
}

async function bodyBytes(body: BodyInit | null | undefined): Promise<Uint8Array | undefined> {
  if (body === undefined || body === null) return undefined
  if (typeof body === 'string') return new TextEncoder().encode(body)
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString())
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer())
  throw new TypeError('desktop carrier does not accept FormData or streaming request bodies')
}
