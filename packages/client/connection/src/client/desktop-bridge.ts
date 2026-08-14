/** Renderer-side validation for the optional Electron preload bridge. */

import type { DesktopConnectionBridge } from '../rpc.ts'

/**
 * Read the optional preload bridge without trusting arbitrary page globals.
 * @returns the validated bridge, or undefined outside the desktop renderer.
 */
export function desktopConnectionBridge(): DesktopConnectionBridge | undefined {
  const value = (globalThis as { dshDesktop?: unknown }).dshDesktop
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<DesktopConnectionBridge>
  return typeof candidate.request === 'function'
    && typeof candidate.cancelRequest === 'function'
    && typeof candidate.openStream === 'function'
    && typeof candidate.cancelStream === 'function'
    && typeof candidate.saveDownload === 'function'
    ? candidate as DesktopConnectionBridge
    : undefined
}
