import { defineConfig } from 'tsdown'

/**
 * The dsh CLI ships the `bin` referenced by package.json plus the reusable
 * profile-boot entry consumed by the desktop application.
 * Declarations come from `tsc -b` (dts: false), matching every package.
 */
export default defineConfig({
  entry: { bin: 'lib/types/bin.js', 'profile-boot': 'lib/types/profile-boot.js' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
