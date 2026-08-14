/** Desktop API carrier: reconstruct Fetch from a context-isolated preload bridge. */

import { AbstractApiClient } from './api.ts'
import { randomUuid } from './random-uuid.ts'
import { HOST_EVENTS_PATH, MUX_EVENTS_PATH } from '../api-path.ts'
import type {
  ConnectionFetch,
  DesktopConnectionBridge,
  DesktopRequest,
  DesktopResponse,
} from '../rpc.ts'

/** API client whose unary and streaming requests cross the context-isolated preload bridge. */
export class DesktopApiClient extends AbstractApiClient {
  /** Fetch-compatible desktop transport exposed to generic RPC clients. */
  readonly fetch: ConnectionFetch = (input, init) => this.desktopFetch(input, init)

  constructor(private readonly bridge: DesktopConnectionBridge) {
    super()
  }

  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return this.desktopFetch(input, init)
  }

  private async desktopFetch(input: URL, init?: RequestInit): Promise<Response> {
    const request = await serializeRequest(input, init)
    return isStreamPath(new URL(request.url))
      ? this.stream(request, init?.signal ?? null)
      : this.unary(request, init?.signal ?? null)
  }

  private async unary(request: DesktopRequest, signal: AbortSignal | null): Promise<Response> {
    if (signal?.aborted === true) throw abortError(signal)
    let aborted = false
    const onAbort = (): void => {
      aborted = true
      this.bridge.cancelRequest(request.id)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await this.bridge.request(request)
      if (aborted && signal !== null) throw abortError(signal)
      return responseOf(response)
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  private stream(request: DesktopRequest, signal: AbortSignal | null): Promise<Response> {
    if (signal?.aborted === true) return Promise.reject(abortError(signal))
    return new Promise<Response>((resolve, reject) => {
      const bridge = this.bridge
      let opened = false
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined
      const cleanup = (): void => { signal?.removeEventListener('abort', onAbort) }
      const onAbort = (): void => {
        this.bridge.cancelStream(request.id)
        const error = abortError(signal as AbortSignal)
        if (opened) controller?.error(error)
        else reject(error)
        cleanup()
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.bridge.openStream(request, {
        opened(response) {
          opened = true
          const body = new ReadableStream<Uint8Array>({
            start(next) { controller = next },
            cancel: () => {
              bridge.cancelStream(request.id)
              cleanup()
            },
          })
          resolve(new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          }))
        },
        data(chunk) { controller?.enqueue(chunk) },
        end() {
          controller?.close()
          cleanup()
        },
        error(message) {
          const error = new Error(message)
          if (opened) controller?.error(error)
          else reject(error)
          cleanup()
        },
      })
    })
  }
}

function isStreamPath(url: URL): boolean {
  return url.pathname === MUX_EVENTS_PATH || url.pathname === HOST_EVENTS_PATH
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError')
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
