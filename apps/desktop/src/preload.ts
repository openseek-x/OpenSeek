/** Context-isolated preload: only structured-clone data and proxied callbacks cross worlds. */

import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopConnectionBridge, DesktopStreamSink } from '@deepseek-ai/dsh-client-connection'
import {
  parseDesktopUpdateState,
  type DesktopUpdateBridge,
} from '@deepseek-ai/dsh-client-connection/desktop-update'
import {
  IPC_FETCH,
  IPC_FETCH_CANCEL,
  IPC_SAVE_DOWNLOAD,
  IPC_STREAM_CANCEL,
  IPC_STREAM_EVENT,
  IPC_STREAM_OPEN,
  IPC_UPDATE_ACTION,
  IPC_UPDATE_GET_STATE,
  IPC_UPDATE_STATE,
  type IpcDownloadRequest,
  type IpcRequest,
  type IpcResponse,
  type IpcStreamEvent,
} from './ipc.ts'

const streams = new Map<string, DesktopStreamSink>()
const updateListeners = new Set<Parameters<DesktopUpdateBridge['onState']>[0]>()
let downloadSequence = 0

function nextDownloadId(): string {
  downloadSequence += 1
  return `download-${String(Date.now())}-${String(downloadSequence)}`
}

ipcRenderer.on(IPC_STREAM_EVENT, (_event, payload: IpcStreamEvent) => {
  const sink = streams.get(payload.id)
  if (sink === undefined) return
  switch (payload.kind) {
    case 'opened':
      sink.opened({ status: payload.status, statusText: payload.statusText, headers: payload.headers })
      break
    case 'data':
      sink.data(payload.chunk)
      break
    case 'end':
      streams.delete(payload.id)
      sink.end()
      break
    case 'error':
      streams.delete(payload.id)
      sink.error(payload.message)
      break
  }
})

ipcRenderer.on(IPC_UPDATE_STATE, (_event, value: unknown) => {
  const state = parseDesktopUpdateState(value)
  for (const listener of updateListeners) listener(state)
})

const bridge: DesktopConnectionBridge = {
  request(request) {
    return ipcRenderer.invoke(IPC_FETCH, request) as Promise<IpcResponse>
  },
  cancelRequest(id) {
    ipcRenderer.send(IPC_FETCH_CANCEL, id)
  },
  openStream(request, sink) {
    const previous = streams.get(request.id)
    if (previous !== undefined) throw new Error(`duplicate desktop stream id ${request.id}`)
    streams.set(request.id, sink)
    ipcRenderer.send(IPC_STREAM_OPEN, request satisfies IpcRequest)
  },
  cancelStream(id) {
    streams.delete(id)
    ipcRenderer.send(IPC_STREAM_CANCEL, id)
  },
  async saveDownload(path, filename) {
    const request: IpcDownloadRequest = { id: nextDownloadId(), path, filename }
    await ipcRenderer.invoke(IPC_SAVE_DOWNLOAD, request)
  },
}

const updateBridge: DesktopUpdateBridge = {
  async getState() {
    return parseDesktopUpdateState(await ipcRenderer.invoke(IPC_UPDATE_GET_STATE) as unknown)
  },
  async act(action) {
    return parseDesktopUpdateState(await ipcRenderer.invoke(IPC_UPDATE_ACTION, action) as unknown)
  },
  onState(listener) {
    updateListeners.add(listener)
    return () => { updateListeners.delete(listener) }
  },
}

contextBridge.exposeInMainWorld('dshDesktop', bridge)
contextBridge.exposeInMainWorld('dshDesktopUpdate', updateBridge)
