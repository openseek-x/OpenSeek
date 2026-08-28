import { clientBundle, clientLibrary } from '../tsdown.client.ts'

const clientConnection = clientBundle('@deepseek-ai/dsh-client-connection', [
  'lib/types/index.js',
  'lib/types/invariant.js',
  'lib/types/desktop-update.js',
])

// The desktop carrier is a standalone Loader entry. Build it independently so
// the tarball's explicit files policy cannot omit a shared sibling chunk.
const desktopCarrier = clientLibrary('@deepseek-ai/dsh-client-connection', [
  'lib/types/desktop.js',
])

export default (inlineConfig: { env?: Record<string, unknown> }) => [
  ...clientConnection(inlineConfig),
  ...desktopCarrier(inlineConfig),
]
