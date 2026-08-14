/** Generic unary RPC contracts shared by the Host and Client Connection halves. */

import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'

/** Trust fence applied before a Host RPC channel reaches its handler. */
export type ConnectionRpcAuthority = 'trusted-host' | 'loopback'

/** Registration policy for one logical RPC channel. */
export interface ConnectionRpcHandlerOptions {
  /** Browser authority accepted by every endpoint in this channel. */
  readonly authority: ConnectionRpcAuthority
}

/** Handler invoked after Connection has decoded the transport envelope. */
export type ConnectionRpcHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<RpcResult<unknown>>

/** Synchronous ownership test for one endpoint on a shared RPC channel. */
export type ConnectionRpcEndpointMatcher = (endpoint: string) => boolean

/** Host registry for logical RPC channels carried by the current transport. */
export interface HostConnectionRpc {
  /**
   * Register one absolute channel prefix and its trust policy.
   * @param channel - absolute logical channel such as `/rpc`.
   * @param handler - decoded endpoint handler returning the existing RPC result shape.
   * @param options - channel trust policy.
   * @returns asynchronous disposer removing the channel and its physical route.
   */
  handle(
    channel: string,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void>

  /**
   * Intercept owned endpoints on the shared `/api` channel before its fallback.
   * @param channel - reserved shared channel; currently `/api`.
   * @param matches - synchronous endpoint ownership test.
   * @param handler - decoded endpoint handler returning the existing RPC result shape.
   * @param options - trust policy for every endpoint claimed by this interceptor.
   * @returns asynchronous disposer removing the interceptor.
   */
  intercept(
    channel: '/api',
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void>
}

/** Host `ctx.connection` shape consumed by transport-independent adapters. */
export interface HostConnectionHandle {
  /** Generic RPC channel registry. */
  readonly rpc: HostConnectionRpc
  /** Dispatch one Fetch-shaped request through registered channels and the API fallback. */
  fetch(request: Request): Promise<Response>
}

/** Client caller for logical RPC channels carried by the current transport. */
export interface ClientConnectionRpc {
  /**
   * Call one endpoint through an already registered logical channel.
   * @param channel - absolute logical channel such as `/api`.
   * @param endpoint - channel-relative endpoint such as `goals/create`.
   * @param payload - channel-owned request payload.
   * @param signal - optional caller cancellation.
   * @returns the existing RPC success/error result; correlation stays inside Connection.
   */
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<RpcResult<unknown>>
}

/** Fetch-shaped request carrier shared by API methods and generic RPC channels. */
export interface ConnectionFetch {
  /**
   * Dispatch one request through the active physical carrier.
   * @param input - absolute URL naming the logical channel and endpoint.
   * @param init - standard Fetch request options.
   * @returns a standard Fetch response after the carrier round trip.
   */
  (input: URL, init?: RequestInit): Promise<Response>
}

/** Desktop bridge injected by the Electron preload in a context-isolated renderer. */
export interface DesktopConnectionBridge {
  /** Dispatch one unary request as structured-clone-only metadata and bytes. */
  request(request: DesktopRequest): Promise<DesktopResponse>
  /** Abort one pending unary request. */
  cancelRequest(id: string): void
  /** Open one streaming response and receive its lifecycle through callbacks. */
  openStream(request: DesktopRequest, sink: DesktopStreamSink): void
  /** Abort one pending or open streaming request. */
  cancelStream(id: string): void
  /** Save a Host download through the desktop shell's native save dialog. */
  saveDownload(path: string, filename: string): Promise<void>
}

/** Structured-clone request exchanged with the Electron preload. */
export interface DesktopRequest {
  readonly id: string
  readonly url: string
  readonly method: string
  readonly headers: [string, string][]
  readonly body?: Uint8Array
}

/** Complete unary response exchanged with the Electron preload. */
export interface DesktopResponse {
  readonly status: number
  readonly statusText: string
  readonly headers: [string, string][]
  readonly body: Uint8Array
}

/** Renderer-owned callbacks used to rebuild a standard streaming Response. */
export interface DesktopStreamSink {
  opened(response: Omit<DesktopResponse, 'body'>): void
  data(chunk: Uint8Array): void
  end(): void
  error(message: string): void
}
