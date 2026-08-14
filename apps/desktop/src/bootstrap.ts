/** CommonJS-compatible Electron entry that loads the bundled ESM main process. */

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const mainEntry = pathToFileURL(join(__dirname, 'main.js')).href

void import(mainEntry).catch((error: unknown) => {
  console.error('dsh desktop: failed to load main process', error)
  process.exitCode = 1
})
