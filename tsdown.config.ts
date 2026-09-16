import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

const HOST_WORKSPACES = {
  include: ['vendor/*', 'packages/*/*', 'apps/cli', 'apps/desktop', 'apps/desktop-host'],
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/test?(s)/**',
    '**/t?(e)mp/**',
    'packages/client/ui-desktop-update',
    'packages/code-runtime/code-runtime-worker-thread',
    'packages/e2b/e2b',
    'packages/examples/agent-spine-demo',
  ],
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project and runs Typert. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  return {
    workspace: client ? ['vendor/*', 'packages/*/*', 'apps/cli'] : HOST_WORKSPACES,
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
