/** Permission policy for the trusted Electron renderer. */

const APP_PROTOCOL = 'dsh:'
const APP_HOST = 'app'

/** Result for one renderer permission request. */
export type DesktopPermissionDecision = 'allow' | 'deny'

/**
 * Decide how Electron handles a protected capability requested by the renderer.
 * @param owner - WebContents belonging to the native application window.
 * @param requester - WebContents asking Electron for permission.
 * @param permission - Electron permission requested by the renderer.
 * @param requestingUrl - Last URL loaded by the requesting frame.
 * @param isMainFrame - Whether the requesting frame is the top-level application frame.
 * @returns `allow` for a request from the owning top-level application frame, or `deny` otherwise.
 */
export function desktopPermissionDecision(
  owner: unknown,
  requester: unknown,
  permission: string,
  requestingUrl: string,
  isMainFrame: boolean,
): DesktopPermissionDecision {
  if (owner === undefined
    || owner !== requester
    || !isMainFrame
    || !isApplicationUrl(requestingUrl)
    || permission.length === 0) return 'deny'
  return 'allow'
}

function isApplicationUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === APP_PROTOCOL && url.host === APP_HOST
  } catch {
    return false
  }
}
