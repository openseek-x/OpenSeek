// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createDesktopTransport } from '../src/client/desktop-api-client.ts'
import type {
  DesktopConnectionBridge,
  DesktopRequest,
  DesktopStreamRequest,
  DesktopStreamSink,
} from '../src/rpc.ts'

describe('desktop Connection transport', () => {
  it('serializes unary RPC Fetch calls through the isolated bridge', async () => {
    const request = vi.fn(async (_message: DesktopRequest) => ({
      status: 200,
      statusText: 'OK',
      headers: [['content-type', 'application/json']] as [string, string][],
      body: new TextEncoder().encode('{"ok":true}'),
    }))
    const bridge: DesktopConnectionBridge = {
      request,
      cancelRequest: vi.fn(),
      openStream: vi.fn(),
      cancelStream: vi.fn(),
      saveDownload: vi.fn(),
    }

    const transport = createDesktopTransport(bridge)
    const response = await transport.fetch(new URL('dsh://app/api/host/describe'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"args":{}}',
    })

    expect(await response.json()).toEqual({ ok: true })
    expect(transport.ownsHost).toBe(true)
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      url: 'dsh://app/api/host/describe',
      method: 'POST',
      headers: [['content-type', 'application/json']],
    })
  })

  it('carries decoded Remote stream values and cancels exactly once', async () => {
    let sink: DesktopStreamSink | undefined
    let request: DesktopStreamRequest | undefined
    const cancelStream = vi.fn()
    const bridge: DesktopConnectionBridge = {
      request: vi.fn(),
      cancelRequest: vi.fn(),
      openStream: vi.fn((next: DesktopStreamRequest, listener: DesktopStreamSink) => {
        request = next
        sink = listener
      }),
      cancelStream,
      saveDownload: vi.fn(),
    }
    const abort = new AbortController()
    const iterator = createDesktopTransport(bridge).openStream('$events', { accepted: true }, abort.signal)[Symbol.asyncIterator]()
    const first = iterator.next()
    await vi.waitFor(() => { expect(sink).toBeDefined() })
    expect(request).toMatchObject({ endpoint: '$events', payload: { accepted: true } })
    sink?.data({ type: 'ready', host: { home: '/tmp' } })
    await expect(first).resolves.toEqual({ done: false, value: { type: 'ready', host: { home: '/tmp' } } })

    abort.abort()
    await expect(iterator.next()).rejects.toThrow('aborted')
    expect(cancelStream).toHaveBeenCalledOnce()
  })
})
