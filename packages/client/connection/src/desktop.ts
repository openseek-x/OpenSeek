/** In-process Host Connection composition for trusted desktop carriers. */

import type { Context } from '@deepseek-ai/cordis'
import { createHostConnection, type ConnectionConfig } from './index.ts'

/** Stable Cordis plugin name for the desktop-only Connection carrier. */
export const name = 'client-connection-desktop'

/** Browser-session state remains owned by the shared credential provider. */
export const inject = ['credentials']

/**
 * Provide the transport-neutral Host Connection registry without binding an
 * HTTP listener. Electron forwards unary requests through IPC and sends Remote
 * streams through the Typert Gateway's in-process carrier.
 * @param ctx - desktop Host context.
 * @param config - Connection trust and body-limit configuration.
 */
export async function apply(ctx: Context, config?: ConnectionConfig): Promise<void> {
  await createHostConnection(ctx, config)
}
