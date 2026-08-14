/** Host registry and HTTP adapter for generic Connection RPC channels. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { WebServer, WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  clientRequestSchema,
  RpcId,
  type ClientRequest,
  type RpcError,
  type RpcErrorDetailsMap,
  type RpcId as RpcIdType,
  type ServerResponse as RpcServerResponse,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { bridge, type FetchHandler } from './http-bridge.ts'
import { isTrustedApiRequest } from './api-request-trust.ts'
import { API_PATH } from './api-path.ts'
import type {
  ConnectionRpcEndpointMatcher,
  ConnectionRpcHandler,
  ConnectionRpcHandlerOptions,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'

const INVALID_REQUEST_RPC_ID = RpcId('invalid-request')
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

interface ConnectionRpcInterceptor {
  readonly matches: ConnectionRpcEndpointMatcher
  readonly fetchHandler: FetchHandler
  readonly options: ConnectionRpcHandlerOptions
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Connection transport and RPC registrations. */
    connection: HostConnectionHandle
  }
}

/** Host Connection service whose channel registrations belong to the caller fiber. */
export class HostConnectionService extends Service implements HostConnectionHandle {
  private readonly interceptors = new Map<string, ConnectionRpcInterceptor>()
  private readonly channels = new Map<string, FetchHandler>()
  private fallback: FetchHandler = { fetch: () => Promise.resolve(new Response('not found', { status: 404 })) }

  /**
   * Provide the Host half over the active HTTP server.
   * @param ctx - owning Connection plugin context.
   * @param trustedHosts - deployment authorities accepted by trusted-host channels.
   */
  constructor(ctx: Context, private readonly trustedHosts: readonly string[]) {
    super(ctx, 'connection')
  }

  /**
   * Install the shared `/api` fallback after the API Proxy bridge has been composed.
   * @param handler - fetch carrier used for unclaimed API endpoints.
   */
  setApiFallback(handler: FetchHandler): void {
    this.fallback = handler
  }

  /** Dispatch a trusted in-process request without applying browser-origin authority checks. */
  fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname
    const channel = longestChannel(pathname, [API_PATH, ...this.channels.keys()])
    if (channel === undefined) return Promise.resolve(new Response('not found', { status: 404 }))
    if (channel === API_PATH) return this.createSharedFetchHandler(API_PATH, this.fallback).fetch(request)
    return this.channels.get(channel)?.fetch(request)
      ?? Promise.resolve(new Response('not found', { status: 404 }))
  }

  /** Generic channel registry scoped to the Context reading this service. */
  get rpc(): HostConnectionRpc {
    const owner = this.ctx
    return {
      handle: (channel, handler, options) => this.register(owner, channel, handler, options),
      intercept: (channel, matches, handler, options) =>
        this.registerInterceptor(owner, channel, matches, handler, options),
    }
  }

  /**
   * Compose one shared-channel Fetch handler from its interceptor and fallback.
   * @param channel - shared channel mounted by Connection.
   * @param fallback - handler for endpoints not claimed by the interceptor.
   * @returns Fetch handler that selects exactly one target for each request.
   */
  createSharedFetchHandler(
    channel: '/api',
    fallback: FetchHandler,
  ): FetchHandler {
    return {
      fetch: (request) => {
        const endpoint = endpointFromPath(channel, new URL(request.url).pathname)
        const interceptor = this.interceptors.get(channel)
        if (endpoint === undefined || interceptor === undefined || !interceptor.matches(endpoint)) {
          return fallback.fetch(request)
        }
        if (interceptor.options.authority === 'loopback' && !isTrustedApiRequest(request, [])) {
          return Promise.resolve(new Response('forbidden', { status: 403 }))
        }
        return interceptor.fetchHandler.fetch(request)
      },
    }
  }

  private register(
    owner: Context,
    channel: string,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void> {
    assertChannel(channel)
    const trustedHosts = options.authority === 'loopback' ? [] : this.trustedHosts
    const fetchHandler = rpcFetchHandler(channel, handler)
    const route: WebRoute = {
      kind: 'prefix',
      path: channel,
      handler: async (req, res) => {
        if (!isTrustedApiRequest(req, trustedHosts)) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        await bridge(req, res, fetchHandler)
      },
    }
    return owner.effect(() => {
      if (this.channels.has(channel)) throw new Error(`connection: duplicate route for rpc channel ${JSON.stringify(channel)}`)
      this.channels.set(channel, fetchHandler)
      let active: { dispose: () => void; webServer: WebServer } | undefined
      const mount = (webServer: WebServer): void => {
        if (active?.webServer === webServer) return
        active?.dispose()
        active = { webServer, dispose: webServer.register(route) }
      }
      const unmount = (webServer?: WebServer): void => {
        if (active === undefined || (webServer !== undefined && active.webServer !== webServer)) return
        active.dispose()
        active = undefined
      }
      const initial = owner.get('webServer') as WebServer | undefined
      if (initial !== undefined) mount(initial)
      const carrier = owner.inject(['webServer'], (webCtx) => {
        mount(webCtx.webServer)
        return () => unmount(webCtx.webServer)
      })
      return async () => {
        unmount()
        this.channels.delete(channel)
        await carrier.dispose()
      }
    }, `client-connection: ${channel} rpc channel`)
  }

  private registerInterceptor(
    owner: Context,
    channel: string,
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void> {
    if (channel !== API_PATH) {
      throw new Error(`connection: invalid shared RPC channel ${JSON.stringify(channel)}`)
    }
    const interceptor: ConnectionRpcInterceptor = {
      matches,
      fetchHandler: rpcFetchHandler(channel, handler),
      options,
    }
    return owner.effect(() => {
      if (this.interceptors.has(channel)) {
        throw new Error(`connection: shared RPC channel ${JSON.stringify(channel)} already has an interceptor`)
      }
      this.interceptors.set(channel, interceptor)
      return () => {
        this.interceptors.delete(channel)
      }
    }, `client-connection: ${channel} rpc interceptor`)
  }
}

function longestChannel(pathname: string, channels: Iterable<string>): string | undefined {
  let selected: string | undefined
  for (const channel of channels) {
    if (pathname !== channel && !pathname.startsWith(`${channel}/`)) continue
    if (selected === undefined || channel.length > selected.length) selected = channel
  }
  return selected
}

function rpcFetchHandler(
  channel: string,
  handler: ConnectionRpcHandler,
): FetchHandler {
  return {
    async fetch(request: Request): Promise<Response> {
      const endpoint = endpointFromPath(channel, new URL(request.url).pathname)
      if (request.method !== 'POST' || endpoint === undefined) {
        return new Response('not found', { status: 404 })
      }

      const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }

      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success) {
        return invalidEnvelopeResponse(body, envelope.error.issues)
      }
      const message: ClientRequest = envelope.data
      if (message.method !== endpoint) {
        return errorResponse(message.rpcId, {
          code: 'bad-request',
          message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
          details: { issues: [] },
        })
      }

      try {
        const result = await handler(endpoint, message.payload, request.signal)
        return fullResponse(message.rpcId, result)
      } catch (error) {
        return new Response(`handler failure: ${String(error)}`, { status: 500 })
      }
    },
  }
}

function invalidEnvelopeResponse(body: unknown, issues: RpcErrorDetailsMap['bad-request']['issues']): Response {
  const rawId = (body as { rpcId?: unknown } | null)?.rpcId
  const rpcId = typeof rawId === 'string' ? RpcId(rawId) : INVALID_REQUEST_RPC_ID
  return errorResponse(rpcId, {
    code: 'bad-request',
    message: 'invalid client-request message',
    details: { issues },
  })
}

function endpointFromPath(channel: string, pathname: string): string | undefined {
  if (!pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  const segments = endpoint.split('/')
  if (segments.some(segment =>
    segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    return undefined
  }
  return endpoint
}

function errorResponse(rpcId: RpcIdType, error: RpcError): Response {
  return fullResponse(rpcId, { ok: false, error })
}

function fullResponse(rpcId: RpcIdType, result: RpcServerResponse['result']): Response {
  const body: RpcServerResponse = { type: 'server-response', rpcId, result }
  return Response.json(body)
}

function assertChannel(channel: string): void {
  if (!CHANNEL_PATTERN.test(channel) || channel === '/api') {
    throw new Error(`connection: invalid or reserved RPC channel ${JSON.stringify(channel)}`)
  }
}
