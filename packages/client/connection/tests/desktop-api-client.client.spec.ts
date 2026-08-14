// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { DesktopApiClient } from '../src/client/desktop-api-client.ts'
import type { DesktopConnectionBridge, DesktopStreamSink } from '../src/rpc.ts'

function responseBody(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

describe('DesktopApiClient', () => {
  it('serializes unary requests and reconstructs byte-exact responses', async () => {
    Object.defineProperty(globalThis, 'location', { value: { origin: 'dsh://app' }, configurable: true })
    const request = vi.fn(async (message) => {
      const envelope = JSON.parse(new TextDecoder().decode(message.body)) as { rpcId: string }
      return {
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'application/json']] as [string, string][],
        body: responseBody({
          type: 'server-response',
          rpcId: envelope.rpcId,
          result: { ok: true, value: { version: 'test', cwd: '/tmp', attachedSessions: 0, canOpenPath: true } },
        }),
      }
    })
    const bridge: DesktopConnectionBridge = {
      request,
      cancelRequest: vi.fn(),
      openStream: vi.fn(),
      cancelStream: vi.fn(),
      saveDownload: vi.fn(),
    }
    const response = await new DesktopApiClient(bridge).host.describe({})

    expect(response.result).toEqual({
      ok: true,
      value: { version: 'test', cwd: '/tmp', attachedSessions: 0, canOpenPath: true },
    })
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      url: 'dsh://app/api/host.describe',
      method: 'POST',
      headers: [['content-type', 'application/json']],
    })
  })

  it('rebuilds streamed SSE responses and propagates renderer cancellation', async () => {
    Object.defineProperty(globalThis, 'location', { value: { origin: 'dsh://app' }, configurable: true })
    let sink: DesktopStreamSink | undefined
    const cancelStream = vi.fn()
    const bridge: DesktopConnectionBridge = {
      request: vi.fn(),
      cancelRequest: vi.fn(),
      openStream: vi.fn((_request, next) => { sink = next }),
      cancelStream,
      saveDownload: vi.fn(),
    }
    const abort = new AbortController()
    const opened = vi.fn()
    const iterator = new DesktopApiClient(bridge).events.mux({}, abort.signal, opened)[Symbol.asyncIterator]()
    const first = iterator.next()
    await vi.waitFor(() => { expect(sink).toBeDefined() })
    sink?.opened({ status: 200, statusText: 'OK', headers: [['content-type', 'text/event-stream']] })
    sink?.data(new TextEncoder().encode('data: {"type":"server-request","rpcId":"desktop-stream","method":"session/subscribed","payload":{"type":"session/subscribed","sessionId":"s1","lastSeq":0}}\n\n'))

    await expect(first).resolves.toMatchObject({
      done: false,
      value: { rpcId: 'desktop-stream', payload: { type: 'session/subscribed', sessionId: 's1', lastSeq: 0 } },
    })
    expect(opened).toHaveBeenCalledOnce()
    abort.abort()
    await iterator.return?.()
    expect(cancelStream).toHaveBeenCalledOnce()
  })
})
