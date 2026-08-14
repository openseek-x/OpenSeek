/** Assemble the built desktop workspace and current host's distribution artifact. */

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
} from 'node:fs'
import { cp } from 'node:fs/promises'
import { arch } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packager } from '../apps/desktop/node_modules/@electron/packager/dist/index.js'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = realpathSync(resolve(scriptDirectory, '..'))
const stageDirectory = resolve(repositoryRoot, 'apps/desktop/.stage')
const outputDirectory = resolve(repositoryRoot, 'dist-desktop')
const installerDirectory = join(outputDirectory, 'installers')
const desktopDirectory = join(repositoryRoot, 'apps/desktop')
const desktopManifest = JSON.parse(
  readFileSync(join(desktopDirectory, 'package.json'), 'utf8'),
) as { version: string; devDependencies: { electron: string } }
const supportedPlatforms = ['darwin', 'win32', 'linux'] as const
type DesktopPlatform = typeof supportedPlatforms[number]
type DesktopArch = 'x64' | 'arm64'

function assertOwnedOutput(path: string): void {
  const pathFromRoot = relative(repositoryRoot, path)
  if (pathFromRoot === ''
    || pathFromRoot === '..'
    || pathFromRoot.startsWith(`..${sep}`)
    || isAbsolute(pathFromRoot)) {
    throw new Error(`package-desktop: refusing output outside repository: ${path}`)
  }
}

function removePathWithoutFollowingLinks(path: string): void {
  if (!existsSync(path)) return
  if (lstatSync(path).isSymbolicLink()) {
    unlinkSync(path)
    return
  }
  rmSync(path, { recursive: true, force: true })
}

function removeOwnedOutput(path: string): void {
  assertOwnedOutput(path)
  removePathWithoutFollowingLinks(path)
}

function resolvePlatform(platform: NodeJS.Platform): DesktopPlatform {
  if (supportedPlatforms.some(candidate => candidate === platform)) return platform as DesktopPlatform
  throw new Error(`package-desktop: unsupported host platform ${platform}`)
}

function resolveArch(value: string): DesktopArch {
  if (value === 'x64' || value === 'arm64') return value
  throw new Error(`package-desktop: unsupported host architecture ${value}`)
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      CI: 'true',
      // Release artifacts intentionally carry no developer certificate.
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    },
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`package-desktop: ${command} exited with status ${String(result.status)}`)
  }
}

const targetPlatform = resolvePlatform(process.platform)
const targetArch = resolveArch(arch())
const appName = 'DeepSeek Harness'
const executableName = targetPlatform === 'linux' ? 'deepseek-harness' : appName
const platformDirectory = join(outputDirectory, `${appName}-${targetPlatform}-${targetArch}`)
const packagedPath = targetPlatform === 'darwin'
  ? join(platformDirectory, `${appName}.app`)
  : platformDirectory

removeOwnedOutput(stageDirectory)
removeOwnedOutput(outputDirectory)
mkdirSync(dirname(stageDirectory), { recursive: true })

try {
  console.log('package-desktop: staging the production workspace')
  run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', [
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

  const icon = targetPlatform === 'darwin'
    ? join(desktopDirectory, 'assets/icon.icns')
    : targetPlatform === 'win32'
      ? join(desktopDirectory, 'assets/icon.ico')
      : undefined
  console.log(`package-desktop: packaging ${appName} for ${targetPlatform}-${targetArch}`)
  await packager({
    dir: stageDirectory,
    name: appName,
    executableName,
    ...(icon === undefined ? {} : { icon }),
    platform: targetPlatform,
    arch: targetArch,
    electronVersion: desktopManifest.devDependencies.electron,
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
      // Packager owns buildPath under its private system-temporary directory.
      removePathWithoutFollowingLinks(buildPath)
      await cp(stageDirectory, buildPath, {
        recursive: true,
        dereference: false,
        verbatimSymlinks: true,
      })
    }],
    ...(targetPlatform === 'darwin'
      ? {
        appBundleId: 'ai.deepseek.harness',
        appCategoryType: 'public.app-category.developer-tools',
      }
      : {}),
    appVersion: desktopManifest.version,
    buildVersion: desktopManifest.version,
  })
} finally {
  removeOwnedOutput(stageDirectory)
}

if (!existsSync(packagedPath)) {
  throw new Error(`package-desktop: packager did not create ${packagedPath}`)
}
if (targetPlatform === 'darwin') {
  console.log('package-desktop: applying a local ad-hoc signature')
  run('codesign', ['--force', '--deep', '--sign', '-', packagedPath])
}

const builderCli = join(desktopDirectory, 'node_modules/electron-builder/cli.js')
const builderConfig = join(desktopDirectory, 'electron-builder.yml')
if (!existsSync(builderCli)) throw new Error(`package-desktop: missing electron-builder CLI: ${builderCli}`)
if (!existsSync(builderConfig)) throw new Error(`package-desktop: missing builder config: ${builderConfig}`)
const target = targetPlatform === 'darwin' ? 'dmg' : targetPlatform === 'win32' ? 'nsis' : 'tar.gz'
console.log(`package-desktop: creating ${target} distribution artifact`)
run(process.execPath, [
  builderCli,
  targetPlatform === 'darwin' ? '--mac' : targetPlatform === 'win32' ? '--win' : '--linux',
  target,
  `--${targetArch}`,
  '--prepackaged', packagedPath,
  '--projectDir', desktopDirectory,
  '--config', builderConfig,
  '--publish', 'never',
])

const artifactSuffix = targetPlatform === 'darwin' ? '.dmg' : targetPlatform === 'win32' ? '.exe' : '.tar.gz'
const artifacts = readdirSync(installerDirectory, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith(artifactSuffix))
  .map(entry => join(installerDirectory, entry.name))
if (artifacts.length !== 1) {
  throw new Error(`package-desktop: expected one ${artifactSuffix} artifact, found ${String(artifacts.length)}`)
}
console.log(`package-desktop: wrote ${packagedPath}`)
console.log(`package-desktop: wrote ${artifacts[0]}`)
