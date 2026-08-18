import { defineConfig } from 'tsdown'

const shared = {
  outDir: 'lib',
  platform: 'node' as const,
  target: 'es2024',
  dts: false,
  clean: false,
  external: ['electron', 'electron-updater'],
}

export default defineConfig([
  {
    ...shared,
    entry: { main: 'lib/types/main.js' },
    format: ['esm'],
    fixedExtension: false,
  },
  {
    ...shared,
    entry: {
      bootstrap: 'lib/types/bootstrap.js',
      preload: 'lib/types/preload.js',
    },
    format: ['cjs'],
    fixedExtension: true,
    // A sandboxed CommonJS preload cannot require the connection package's
    // ESM-only wire subpath, so keep the parser inside the preload artifact.
    noExternal: id => id === '@deepseek-ai/dsh-client-connection/desktop-update',
  },
])
