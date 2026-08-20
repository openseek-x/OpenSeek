/** Shared structured-clone protocol between the Electron main process and preload. */

export const IPC_FETCH = 'dsh:fetch'
export const IPC_FETCH_CANCEL = 'dsh:fetch-cancel'
export const IPC_STREAM_OPEN = 'dsh:stream-open'
export const IPC_STREAM_CANCEL = 'dsh:stream-cancel'
export const IPC_STREAM_EVENT = 'dsh:stream-event'
export const IPC_SAVE_DOWNLOAD = 'dsh:save-download'
export const IPC_UPDATE_GET_STATE = 'dsh:update:get-state'
export const IPC_UPDATE_ACTION = 'dsh:update:action'
export const IPC_UPDATE_STATE = 'dsh:update:state'
export const IPC_WINDOW_DRAG_START = 'dsh:window-drag:start'
export const IPC_WINDOW_DRAG_MOVE = 'dsh:window-drag:move'
export const IPC_WINDOW_DRAG_END = 'dsh:window-drag:end'

/** Upper bound shared with the default Connection HTTP carrier. */
export const MAX_REQUEST_BODY_BYTES = 160 * 1024 * 1024

/** Request representation accepted from the isolated renderer. */
export interface IpcRequest {
  readonly id: string
  readonly url: string
  readonly method: string
  readonly headers: [string, string][]
  readonly body?: Uint8Array
}

/** Complete non-streaming response returned through invoke. */
export interface IpcResponse {
  readonly status: number
  readonly statusText: string
  readonly headers: [string, string][]
  readonly body: Uint8Array
}

/** Native-download request; the main process owns both Fetch and disk I/O. */
export interface IpcDownloadRequest {
  readonly id: string
  readonly path: string
  readonly filename: string
}

/** Pointer coordinates sent from preload while moving the native application window. */
export interface IpcWindowDragPoint {
  readonly screenX: number
  readonly screenY: number
}

/** Main-to-preload events for one streamed Fetch response. */
export type IpcStreamEvent =
  | { readonly id: string; readonly kind: 'opened'; readonly status: number; readonly statusText: string; readonly headers: [string, string][] }
  | { readonly id: string; readonly kind: 'data'; readonly chunk: Uint8Array }
  | { readonly id: string; readonly kind: 'end' }
  | { readonly id: string; readonly kind: 'error'; readonly message: string }
