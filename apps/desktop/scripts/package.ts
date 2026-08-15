/** Assemble the built desktop workspace and current host's distribution artifact. */

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { arch, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packager } from '@electron/packager'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = realpathSync(resolve(scriptDirectory, '../../..'))
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

interface UpdateRepository {
  owner: string
  repository: string
}

interface DesktopUpdateRuntimeConfig extends UpdateRepository {
  version: 1
  enabled: boolean
  channel: string
  startupDelayMs: number
  intervalMs: number
  noticeDurationMs: number
  installHandoffTimeoutMs: number
}

const SAFE_REPOSITORY_SEGMENT = /^[A-Za-z0-9_.-]+$/

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

function resolveBooleanEnvironment(name: string, fallback: boolean): boolean {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`package-desktop: ${name} must be true or false`)
}

function resolveIntegerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`package-desktop: ${name} must be an integer from ${String(minimum)} to ${String(maximum)}`)
  }
  return parsed
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`package-desktop: ${name} is required for an updater-enabled release`)
  }
  return value
}

function isSafeToken(value: string, maximum: number): boolean {
  return value.length > 0
    && value.length <= maximum
    && value !== '.'
    && value !== '..'
    && SAFE_REPOSITORY_SEGMENT.test(value)
}

function resolveUpdateRepository(): UpdateRepository {
  const slug = process.env.DESKTOP_UPDATE_REPOSITORY
    ?? process.env.GITHUB_REPOSITORY
    ?? 'openseek-x/OpenSeek'
  const [owner, repository, extra] = slug.split('/')
  if (owner === undefined
    || repository === undefined
    || extra !== undefined
    || !isSafeToken(owner, 100)
    || !isSafeToken(repository, 100)) {
    throw new Error('package-desktop: DESKTOP_UPDATE_REPOSITORY must be owner/repository')
  }
  return { owner, repository }
}

function run(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv = {},
): void {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      ...environment,
      CI: 'true',
      // Packager owns application signing. Builder consumes that prepackaged
      // application and only signs the Windows installer through CSC_LINK.
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    },
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`package-desktop: ${command} exited with status ${String(result.status)}`)
  }
}

function runPnpm(args: string[]): void {
  const entrypoint = process.env.npm_execpath
  if (entrypoint === undefined || entrypoint === '') {
    throw new Error('package-desktop: npm_execpath is unavailable; invoke packaging through a pnpm package script')
  }
  // Windows cannot spawn pnpm.cmd directly; the JavaScript entrypoint keeps every host shell-free.
  run(process.execPath, [entrypoint, ...args])
}

/** Resolve a POSIX launcher's own directory, including when invoked through a symbolic link. */
function resolveShellLauncherDirectory(): string[] {
  return [
    'launcher_path=$0',
    'case "$launcher_path" in */*) ;; *) launcher_path=$(command -v "$launcher_path") ;; esac',
    'while [ -L "$launcher_path" ]; do',
    '  link=$(/usr/bin/readlink "$launcher_path")',
    '  case "$link" in /*) launcher_path=$link ;; *) launcher_path=${launcher_path%/*}/$link ;; esac',
    'done',
    'launcher_dir=${launcher_path%/*}',
    '[ "$launcher_dir" != "$launcher_path" ] || launcher_dir=.',
    'launcher_dir=$(CDPATH= cd -- "$launcher_dir" && pwd)',
  ]
}

/** Write an executable POSIX shell launcher. */
function writeShellLauncher(path: string, commands: string[]): void {
  writeFileSync(path, ['#!/bin/sh', 'set -eu', ...resolveShellLauncherDirectory(), ...commands, ''].join('\n'))
  chmodSync(path, 0o755)
}

/** Return the public companion launcher path for one packaged application. */
function resolveCompanionCli(
  platform: DesktopPlatform,
  appPath: string,
  resourcesCompanion = false,
): string {
  if (platform === 'darwin') {
    return join(appPath, 'Contents', resourcesCompanion ? 'Resources/bin' : 'MacOS', 'dsh')
  }
  return join(appPath, platform === 'win32' ? 'dsh.cmd' : 'dsh')
}

/** Add the self-contained dsh companion and its private runtime shims before application signing. */
function writeCompanionCli(
  platform: DesktopPlatform,
  appPath: string,
  resourcesCompanion = false,
): void {
  // macOS exposes the temporary directory through both /var and /private/var.
  // Normalize the whole application root before deriving relative paths so a
  // resolved dependency cannot bake that alias transition into a launcher.
  const resolvedAppPath = realpathSync(appPath)
  const cliEntry = platform === 'darwin'
    ? join(resolvedAppPath, 'Contents', 'Resources', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    : join(resolvedAppPath, 'resources', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!existsSync(cliEntry)) throw new Error(`package-desktop: missing deployed dsh CLI entry: ${cliEntry}`)
  const pnpmEntry = join(dirname(createRequire(realpathSync(cliEntry)).resolve('pnpm')), 'bin', 'pnpm.mjs')
  if (!existsSync(pnpmEntry)) throw new Error(`package-desktop: missing deployed pnpm entry: ${pnpmEntry}`)

  const executable = platform === 'darwin'
    ? join(resolvedAppPath, 'Contents', 'MacOS', 'DeepSeek Harness')
    : join(resolvedAppPath, platform === 'win32' ? 'DeepSeek Harness.exe' : 'deepseek-harness')
  const runtimeDirectory = platform === 'darwin'
    ? join(resolvedAppPath, 'Contents', 'Resources', 'dsh-bin')
    : join(resolvedAppPath, 'resources', 'dsh-bin')
  mkdirSync(runtimeDirectory, { recursive: true })

  if (platform === 'win32') {
    writeFileSync(join(runtimeDirectory, 'node.cmd'), [
      '@echo off',
      'setlocal',
      'set "ELECTRON_RUN_AS_NODE=1"',
      `"%~dp0${relative(runtimeDirectory, executable)}" %*`,
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n'))
    writeFileSync(join(runtimeDirectory, 'pnpm.cmd'), [
      '@echo off',
      'setlocal',
      'set "ELECTRON_RUN_AS_NODE=1"',
      `"%~dp0${relative(runtimeDirectory, executable)}" "%~dp0${relative(runtimeDirectory, pnpmEntry)}" %*`,
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n'))
    writeFileSync(resolveCompanionCli(platform, resolvedAppPath), [
      '@echo off',
      'setlocal',
      'set "ELECTRON_RUN_AS_NODE=1"',
      'set "PATH=%~dp0resources\\dsh-bin;%PATH%"',
      '"%~dp0DeepSeek Harness.exe" "%~dp0resources\\app\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*',
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n'))
    return
  }

  const launcher = resolveCompanionCli(platform, resolvedAppPath, resourcesCompanion)
  mkdirSync(dirname(launcher), { recursive: true })
  writeShellLauncher(join(runtimeDirectory, 'node'), [
    'export ELECTRON_RUN_AS_NODE=1',
    `exec "$launcher_dir/${relative(runtimeDirectory, executable)}" "$@"`,
  ])
  writeShellLauncher(join(runtimeDirectory, 'pnpm'), [
    'export ELECTRON_RUN_AS_NODE=1',
    `exec "$launcher_dir/${relative(runtimeDirectory, executable)}" `
      + `"$launcher_dir/${relative(runtimeDirectory, pnpmEntry)}" "$@"`,
  ])
  writeShellLauncher(launcher, [
    `runtime_dir="$launcher_dir/${relative(dirname(launcher), runtimeDirectory)}"`,
    'PATH="$runtime_dir${PATH:+:$PATH}"',
    'ELECTRON_RUN_AS_NODE=1',
    'export ELECTRON_RUN_AS_NODE PATH',
    `exec "$launcher_dir/${relative(dirname(launcher), executable)}" `
      + `"$launcher_dir/${relative(dirname(launcher), cliEntry)}" "$@"`,
  ])
  if (platform === 'darwin' && resourcesCompanion) {
    symlinkSync('../Resources/bin/dsh', resolveCompanionCli(platform, resolvedAppPath))
  }
}

const targetPlatform = resolvePlatform(process.platform)
const targetArch = resolveArch(arch())
const updateRepository = resolveUpdateRepository()
const updateChannel = targetPlatform === 'darwin' ? `latest-${targetArch}` : 'latest'
const releaseBuild = resolveBooleanEnvironment('DESKTOP_RELEASE_BUILD', false)
const updatesRequested = resolveBooleanEnvironment('DESKTOP_UPDATES_ENABLED', false)
const certificateFreeUpdateBuild = resolveBooleanEnvironment(
  'DESKTOP_CERTIFICATE_FREE_UPDATE_BUILD',
  false,
)
if (targetPlatform === 'linux' && updatesRequested) {
  throw new Error('package-desktop: Linux only supports release-page downloads')
}
const updatesEnabled = targetPlatform !== 'linux' && updatesRequested
if (certificateFreeUpdateBuild
  && ((targetPlatform !== 'darwin' && targetPlatform !== 'win32')
    || !updatesEnabled
    || desktopManifest.version !== '0.1.0')) {
  throw new Error(
    'package-desktop: DESKTOP_CERTIFICATE_FREE_UPDATE_BUILD requires a macOS or Windows 0.1.0 updater-enabled build',
  )
}
if (releaseBuild
  && targetPlatform !== 'linux'
  && !updatesEnabled) {
  throw new Error('package-desktop: release macOS and Windows packages must enable updates')
}

const updateRuntimeConfig: DesktopUpdateRuntimeConfig = {
  version: 1,
  enabled: updatesEnabled,
  ...updateRepository,
  channel: updateChannel,
  startupDelayMs: resolveIntegerEnvironment(
    'DESKTOP_UPDATE_STARTUP_DELAY_MS',
    30_000,
    1_000,
    30 * 60 * 1_000,
  ),
  intervalMs: resolveIntegerEnvironment(
    'DESKTOP_UPDATE_INTERVAL_MS',
    4 * 60 * 60 * 1_000,
    15 * 60 * 1_000,
    7 * 24 * 60 * 60 * 1_000,
  ),
  noticeDurationMs: resolveIntegerEnvironment(
    'DESKTOP_UPDATE_NOTICE_DURATION_MS',
    5_000,
    1_000,
    60_000,
  ),
  installHandoffTimeoutMs: resolveIntegerEnvironment(
    'DESKTOP_UPDATE_INSTALL_HANDOFF_TIMEOUT_MS',
    120_000,
    10_000,
    10 * 60 * 1_000,
  ),
}

const macSigning = targetPlatform === 'darwin' && updatesEnabled && !certificateFreeUpdateBuild
  ? {
    identity: requiredEnvironment('DESKTOP_MAC_SIGN_IDENTITY'),
    appleId: requiredEnvironment('APPLE_ID'),
    appleIdPassword: requiredEnvironment('APPLE_APP_SPECIFIC_PASSWORD'),
    teamId: requiredEnvironment('APPLE_TEAM_ID'),
  }
  : undefined
const windowsSigning = targetPlatform === 'win32' && updatesEnabled && !certificateFreeUpdateBuild
  ? {
    certificateFile: requiredEnvironment('WINDOWS_CERTIFICATE_FILE'),
    certificatePassword: requiredEnvironment('WINDOWS_CERTIFICATE_PASSWORD'),
    publisherName: requiredEnvironment('DESKTOP_WINDOWS_PUBLISHER_NAME'),
  }
  : undefined
if (windowsSigning !== undefined && !existsSync(windowsSigning.certificateFile)) {
  throw new Error(`package-desktop: Windows certificate does not exist: ${windowsSigning.certificateFile}`)
}

const appName = 'DeepSeek Harness'
const packagerName = targetPlatform === 'linux' ? 'DeepSeek-Harness' : appName
const executableName = targetPlatform === 'linux' ? 'deepseek-harness' : appName
const platformDirectory = join(outputDirectory, `${packagerName}-${targetPlatform}-${targetArch}`)
const packagedPath = targetPlatform === 'darwin'
  ? join(platformDirectory, `${appName}.app`)
  : platformDirectory
const packagedResourcesDirectory = targetPlatform === 'darwin'
  ? join(packagedPath, 'Contents/Resources')
  : join(packagedPath, 'resources')
const releaseConfigDirectory = mkdtempSync(join(tmpdir(), 'dsh-desktop-update-'))
const appUpdateConfigPath = join(releaseConfigDirectory, 'app-update.yml')
const runtimeConfigPath = join(releaseConfigDirectory, 'desktop-update.json')

try {
  writeFileSync(appUpdateConfigPath, [
    'provider: github',
    `owner: ${JSON.stringify(updateRepository.owner)}`,
    `repo: ${JSON.stringify(updateRepository.repository)}`,
    `channel: ${JSON.stringify(updateChannel)}`,
    ...(windowsSigning === undefined
      ? []
      : [`publisherName: ${JSON.stringify(windowsSigning.publisherName)}`]),
    'updaterCacheDirName: deepseek-harness-updater',
    '',
  ].join('\n'))
  writeFileSync(runtimeConfigPath, `${JSON.stringify(updateRuntimeConfig, undefined, 2)}\n`)

  removeOwnedOutput(stageDirectory)
  removeOwnedOutput(outputDirectory)
  mkdirSync(dirname(stageDirectory), { recursive: true })

  console.log('package-desktop: staging the production workspace')
  runPnpm([
    '--filter', '@deepseek-ai/dsh-desktop',
    'deploy', '--prod', '--config.inject-workspace-packages=true',
    // The portable deploy rewrites the reviewed workspace postinstall's file:
    // key; run that one script explicitly below instead of broadening allowBuilds.
    '--config.strict-dep-builds=false',
    // NSIS dereferences links while creating its embedded archive. A hoisted
    // Windows deployment avoids expanding pnpm's linked dependency graph.
    ...(targetPlatform === 'win32' ? ['--config.node-linker=hoisted'] : []),
    stageDirectory,
  ])

  const spawnHelperRepair = join(
    stageDirectory,
    targetPlatform === 'win32'
      ? 'node_modules/@deepseek-ai/dsh-subprocess-local/scripts/ensure-spawn-helper.mjs'
      : 'node_modules/.pnpm/node_modules/@deepseek-ai/dsh-subprocess-local/scripts/ensure-spawn-helper.mjs',
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
    name: packagerName,
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
    // These files must be present before Packager signs the application. On
    // macOS this places them inside the sealed application bundle.
    extraResource: [appUpdateConfigPath, runtimeConfigPath],
    // The companion and private shims are also part of the signed application.
    afterCopyExtraResources: [({ buildPath }) => {
      writeCompanionCli(
        targetPlatform,
        targetPlatform === 'darwin' ? join(buildPath, `${appName}.app`) : buildPath,
        certificateFreeUpdateBuild,
      )
    }],
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
        ...(macSigning === undefined
          ? {}
          : {
            osxSign: {
              identity: macSigning.identity,
              optionsForFile: () => ({ hardenedRuntime: true }),
              strictVerify: true,
              continueOnError: false,
            },
            osxNotarize: {
              appleId: macSigning.appleId,
              appleIdPassword: macSigning.appleIdPassword,
              teamId: macSigning.teamId,
            },
          }),
      }
      : {}),
    ...(windowsSigning === undefined
      ? {}
      : {
        windowsSign: {
          certificateFile: windowsSigning.certificateFile,
          certificatePassword: windowsSigning.certificatePassword,
          continueOnError: false,
        },
      }),
    appVersion: desktopManifest.version,
    buildVersion: desktopManifest.version,
  })
} finally {
  removeOwnedOutput(stageDirectory)
  removePathWithoutFollowingLinks(releaseConfigDirectory)
}

if (!existsSync(packagedPath)) {
  throw new Error(`package-desktop: packager did not create ${packagedPath}`)
}
const companionCli = resolveCompanionCli(targetPlatform, packagedPath)
if (!existsSync(companionCli)) {
  throw new Error(`package-desktop: Packager did not inject ${companionCli}`)
}
for (const configName of ['app-update.yml', 'desktop-update.json']) {
  const packagedConfig = join(packagedResourcesDirectory, configName)
  if (!existsSync(packagedConfig)) {
    throw new Error(`package-desktop: Packager did not inject ${packagedConfig}`)
  }
}
if (targetPlatform === 'darwin' && macSigning === undefined) {
  console.log('package-desktop: applying a local ad-hoc signature')
  run('codesign', ['--force', '--deep', '--sign', '-', packagedPath])
  if (certificateFreeUpdateBuild) {
    run('codesign', [
      '--force',
      '--sign',
      '-',
      '--requirements',
      '=designated => identifier "ai.deepseek.harness"',
      packagedPath,
    ])
  }
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', packagedPath])
}
if (targetPlatform === 'darwin' && macSigning !== undefined) {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', packagedPath])
  run('xcrun', ['stapler', 'validate', packagedPath])
}

const builderCli = join(desktopDirectory, 'node_modules/electron-builder/cli.js')
const builderConfig = join(desktopDirectory, 'electron-builder.yml')
if (!existsSync(builderCli)) throw new Error(`package-desktop: missing electron-builder CLI: ${builderCli}`)
if (!existsSync(builderConfig)) throw new Error(`package-desktop: missing builder config: ${builderConfig}`)
const targets = targetPlatform === 'darwin'
  ? ['dmg', 'zip']
  : targetPlatform === 'win32'
    ? ['nsis']
    : ['tar.gz']
console.log(`package-desktop: creating ${targets.join(' and ')} distribution artifacts`)
run(process.execPath, [
  builderCli,
  targetPlatform === 'darwin' ? '--mac' : targetPlatform === 'win32' ? '--win' : '--linux',
  ...targets,
  `--${targetArch}`,
  '--prepackaged', packagedPath,
  '--projectDir', desktopDirectory,
  '--config', builderConfig,
  '--publish', 'never',
], {
  DESKTOP_UPDATE_OWNER: updateRepository.owner,
  DESKTOP_UPDATE_REPOSITORY_NAME: updateRepository.repository,
  DESKTOP_UPDATE_CHANNEL: updateChannel,
})
if (targetPlatform === 'darwin') {
  for (const file of readdirSync(installerDirectory)) {
    if (file.endsWith('.dmg.blockmap')) unlinkSync(join(installerDirectory, file))
  }
}

const installerFiles = readdirSync(installerDirectory, { withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => entry.name)

function requireOneArtifact(description: string, predicate: (file: string) => boolean): string {
  const matches = installerFiles.filter(predicate)
  const [artifact, extra] = matches
  if (artifact === undefined || extra !== undefined) {
    throw new Error(`package-desktop: expected one ${description}, found ${String(matches.length)}`)
  }
  return join(installerDirectory, artifact)
}

const artifacts = targetPlatform === 'darwin'
  ? [
    requireOneArtifact('DMG artifact', file => file.endsWith('.dmg')),
    requireOneArtifact('ZIP artifact', file => file.endsWith('.zip')),
    requireOneArtifact('ZIP blockmap', file => file.endsWith('.zip.blockmap')),
    requireOneArtifact(
      `${updateChannel}-mac.yml update metadata`,
      file => file === `${updateChannel}-mac.yml`,
    ),
  ]
  : targetPlatform === 'win32'
    ? [
      requireOneArtifact('NSIS artifact', file => file.endsWith('.exe')),
      requireOneArtifact('NSIS blockmap', file => file.endsWith('.exe.blockmap')),
      requireOneArtifact('latest.yml update metadata', file => file === 'latest.yml'),
    ]
    : [requireOneArtifact('tar.gz artifact', file => file.endsWith('.tar.gz'))]

console.log(`package-desktop: wrote ${packagedPath}`)
console.log(`package-desktop: wrote ${companionCli}`)
for (const artifact of artifacts) console.log(`package-desktop: wrote ${artifact}`)
