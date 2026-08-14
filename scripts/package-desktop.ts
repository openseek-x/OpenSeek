/** Assemble the built desktop workspace into a self-contained macOS app. */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { arch } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packager } from '../apps/desktop/node_modules/@electron/packager/dist/index.js'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = realpathSync(resolve(scriptDirectory, '..'))
const stageDirectory = resolve(repositoryRoot, 'apps/desktop/.stage')
const outputDirectory = resolve(repositoryRoot, 'dist-desktop')
const desktopManifest = JSON.parse(
  readFileSync(join(repositoryRoot, 'apps/desktop/package.json'), 'utf8'),
) as { version: string }

function assertOwnedOutput(path: string): void {
  const pathFromRoot = relative(repositoryRoot, path)
  if (pathFromRoot === ''
    || pathFromRoot === '..'
    || pathFromRoot.startsWith(`..${sep}`)
    || isAbsolute(pathFromRoot)) {
    throw new Error(`package-desktop: refusing output outside repository: ${path}`)
  }
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, CI: 'true' },
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`package-desktop: ${command} exited with status ${String(result.status)}`)
  }
}

if (process.platform !== 'darwin') {
  throw new Error('package-desktop: this command currently packages macOS only')
}

assertOwnedOutput(stageDirectory)
assertOwnedOutput(outputDirectory)
rmSync(stageDirectory, { recursive: true, force: true })
rmSync(outputDirectory, { recursive: true, force: true })
mkdirSync(dirname(stageDirectory), { recursive: true })

console.log('package-desktop: staging the production workspace')
run('pnpm', [
  '--filter', '@deepseek-ai/dsh-desktop',
  'deploy', '--prod', '--config.inject-workspace-packages=true',
  // The portable deploy rewrites the reviewed workspace postinstall's file:
  // key; run that one script explicitly below instead of broadening allowBuilds.
  '--config.strict-dep-builds=false',
  stageDirectory,
])

const spawnHelperRepair = join(
  stageDirectory,
  'node_modules/.pnpm/node_modules/@deepseek-ai/dsh-subprocess-local/scripts/ensure-spawn-helper.mjs',
)
if (!existsSync(spawnHelperRepair)) {
  throw new Error(`package-desktop: missing deployed PTY helper repair: ${spawnHelperRepair}`)
}
run(process.execPath, [spawnHelperRepair])

const targetArch = arch() === 'x64' ? 'x64' : 'arm64'
console.log(`package-desktop: packaging DeepSeek Harness for darwin-${targetArch}`)
await packager({
  dir: stageDirectory,
  name: 'DeepSeek Harness',
  icon: join(repositoryRoot, 'apps/desktop/assets/icon.icns'),
  platform: 'darwin',
  arch: targetArch,
  out: outputDirectory,
  overwrite: true,
  // Keep the pnpm deployment as a real directory. Its relative symlink graph
  // is relocatable, but ASAR rejects dependency links that cross virtual-store
  // package boundaries before it can preserve them.
  asar: false,
  prune: false,
  // Keep pnpm's portable relative links intact while copying. The asar stage
  // resolves them inside the already self-contained deployment directory.
  derefSymlinks: false,
  afterCopy: [async ({ buildPath }) => {
    // Node's default recursive copy rewrites relative links to absolute source
    // paths when dereferencing is disabled. Replace just the application copy
    // with verbatim relative links; the Electron template remains untouched.
    rmSync(buildPath, { recursive: true, force: true })
    await cp(stageDirectory, buildPath, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    })
  }],
  appBundleId: 'ai.deepseek.harness',
  appCategoryType: 'public.app-category.developer-tools',
  appVersion: desktopManifest.version,
  buildVersion: desktopManifest.version,
})

const appPath = join(outputDirectory, `DeepSeek Harness-darwin-${targetArch}`, 'DeepSeek Harness.app')
console.log('package-desktop: applying a local ad-hoc signature')
run('codesign', ['--force', '--deep', '--sign', '-', appPath])
rmSync(stageDirectory, { recursive: true, force: true })
console.log(`package-desktop: wrote ${appPath}`)
