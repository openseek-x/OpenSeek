/** Verify one platform's Electron Builder feed against its packaged artifacts. */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

/** Native platform identifiers accepted by the release workflow. */
export type DesktopReleasePlatform = 'macos-arm64' | 'macos-x64' | 'windows-x64'

interface ArtifactMetadata {
  url: string
  sha512: string
  size: number
}

interface PlatformLayout {
  feed: string
  primary: string
  artifacts: string[]
  files: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function layout(platform: DesktopReleasePlatform, version: string): PlatformLayout {
  const prefix = `DeepSeek-Harness-${version}`
  if (platform === 'windows-x64') {
    const installer = `${prefix}-win-x64.exe`
    return {
      feed: 'latest.yml',
      primary: installer,
      artifacts: [installer],
      files: [installer, `${installer}.blockmap`, 'latest.yml'],
    }
  }
  const architecture = platform === 'macos-arm64' ? 'arm64' : 'x64'
  const zip = `${prefix}-mac-${architecture}.zip`
  const dmg = `${prefix}-mac-${architecture}.dmg`
  const feed = `latest-${architecture}-mac.yml`
  return {
    feed,
    primary: zip,
    artifacts: [zip, dmg],
    files: [dmg, zip, `${zip}.blockmap`, feed],
  }
}

async function sha512(path: string): Promise<string> {
  const hash = createHash('sha512')
  await pipeline(createReadStream(path), hash)
  return hash.digest('base64')
}

async function artifactMetadata(path: string): Promise<ArtifactMetadata> {
  const [info, digest] = await Promise.all([stat(path), sha512(path)])
  if (!info.isFile()) throw new Error(`desktop update artifact is not a file: ${path}`)
  return { url: basename(path), sha512: digest, size: info.size }
}

function assertSameFiles(actual: string[], expected: string[], directory: string): void {
  const sortedActual = [...actual].sort()
  const sortedExpected = [...expected].sort()
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `desktop update files differ in ${directory}: expected ${sortedExpected.join(', ')}, got ${sortedActual.join(', ')}`,
    )
  }
}

/**
 * Verify an emitted feed, its primary path, and every platform artifact digest.
 * @param directory - installer directory produced by one native package job.
 * @param platform - release matrix platform represented by the directory.
 * @param version - stable desktop package version embedded in filenames and metadata.
 */
export async function verifyDesktopUpdateMetadata(
  directory: string,
  platform: DesktopReleasePlatform,
  version: string,
): Promise<void> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`desktop update metadata requires a stable X.Y.Z version, got ${version}`)
  }
  const expected = layout(platform, version)
  const directoryEntries = await readdir(directory, { withFileTypes: true })
  if (directoryEntries.some(entry => !entry.isFile())) {
    throw new Error(`desktop update directory contains a non-file entry: ${directory}`)
  }
  assertSameFiles(directoryEntries.map(entry => entry.name), expected.files, directory)

  const metadataEntries = await Promise.all(expected.artifacts.map(async name => (
    [name, await artifactMetadata(join(directory, name))] as const
  )))
  const metadataByName = new Map(metadataEntries)
  const document = yaml.load(await readFile(join(directory, expected.feed), 'utf8'))
  if (!isRecord(document)
    || document.version !== version
    || !Array.isArray(document.files)
    || typeof document.path !== 'string'
    || typeof document.sha512 !== 'string'
    || typeof document.releaseDate !== 'string'
    || Number.isNaN(Date.parse(document.releaseDate))) {
    throw new Error(`${expected.feed} has invalid update metadata`)
  }

  if (document.files.length !== metadataByName.size) {
    throw new Error(`${expected.feed} must describe exactly ${String(metadataByName.size)} artifact(s)`)
  }
  const seen = new Set<string>()
  for (const entry of document.files) {
    if (!isRecord(entry)
      || typeof entry.url !== 'string'
      || typeof entry.sha512 !== 'string'
      || !Number.isSafeInteger(entry.size)) {
      throw new Error(`${expected.feed} contains an invalid files entry`)
    }
    const artifact = metadataByName.get(entry.url)
    if (artifact === undefined || seen.has(entry.url)) {
      throw new Error(`${expected.feed} contains an unexpected or duplicate artifact: ${entry.url}`)
    }
    if (entry.sha512 !== artifact.sha512 || entry.size !== artifact.size) {
      throw new Error(`${expected.feed} digest or size differs for ${entry.url}`)
    }
    seen.add(entry.url)
  }

  const primary = metadataByName.get(expected.primary)
  if (primary === undefined) throw new Error(`desktop update primary artifact is missing: ${expected.primary}`)
  if (document.path !== primary.url || document.sha512 !== primary.sha512) {
    throw new Error(`${expected.feed} primary path or digest differs from ${expected.primary}`)
  }
}

function isDesktopReleasePlatform(value: string): value is DesktopReleasePlatform {
  return value === 'macos-arm64' || value === 'macos-x64' || value === 'windows-x64'
}

async function main(): Promise<void> {
  const [directoryArgument, platformArgument, extra] = process.argv.slice(2)
  if (directoryArgument === undefined
    || platformArgument === undefined
    || extra !== undefined
    || !isDesktopReleasePlatform(platformArgument)) {
    throw new Error(
      'usage: verify-desktop-update-metadata <installer-directory> <macos-arm64|macos-x64|windows-x64>',
    )
  }
  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const manifest = JSON.parse(
    await readFile(resolve(scriptDirectory, '../apps/desktop/package.json'), 'utf8'),
  ) as unknown
  if (!isRecord(manifest) || typeof manifest.version !== 'string') {
    throw new Error('apps/desktop/package.json has no version')
  }
  const directory = resolve(directoryArgument)
  await verifyDesktopUpdateMetadata(directory, platformArgument, manifest.version)
  console.log(`verify-desktop-update-metadata: ${platformArgument} feed matches its packaged artifacts.`)
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) await main()
