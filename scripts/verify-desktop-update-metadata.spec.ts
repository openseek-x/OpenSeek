import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as yaml from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import {
  verifyDesktopUpdateMetadata,
  type DesktopReleasePlatform,
} from './verify-desktop-update-metadata.ts'

const version = '1.2.3'
const temporaryDirectories: string[] = []

interface Fixture {
  directory: string
  feed: Record<string, unknown>
  feedName: string
  platform: DesktopReleasePlatform
}

function metadata(name: string, content: string): { url: string; sha512: string; size: number } {
  return {
    url: name,
    sha512: createHash('sha512').update(content).digest('base64'),
    size: Buffer.byteLength(content),
  }
}

async function fixture(platform: DesktopReleasePlatform): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-desktop-feed-'))
  temporaryDirectories.push(directory)
  const prefix = `DeepSeek-Harness-${version}`
  const windows = platform === 'windows-x64'
  const architecture = platform === 'macos-arm64' ? 'arm64' : 'x64'
  const primaryName = windows ? `${prefix}-win-x64.exe` : `${prefix}-mac-${architecture}.zip`
  const primaryContent = `${platform} primary artifact`
  const primary = metadata(primaryName, primaryContent)
  const artifacts = windows
    ? [primary]
    : [
      primary,
      metadata(`${prefix}-mac-${architecture}.dmg`, `${platform} disk image`),
    ]
  for (const artifact of artifacts) {
    const content = artifact.url === primaryName ? primaryContent : `${platform} disk image`
    await writeFile(join(directory, artifact.url), content)
  }
  await writeFile(join(directory, `${primaryName}.blockmap`), 'blockmap')
  const feedName = windows ? 'latest.yml' : `latest-${architecture}-mac.yml`
  const feed: Record<string, unknown> = {
    version,
    files: artifacts,
    path: primary.url,
    sha512: primary.sha512,
    releaseDate: '2026-08-14T00:00:00.000Z',
  }
  await writeFile(join(directory, feedName), yaml.dump(feed))
  return { directory, feed, feedName, platform }
}

async function writeFeed(value: Fixture): Promise<void> {
  await writeFile(join(value.directory, value.feedName), yaml.dump(value.feed))
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('desktop update release metadata', () => {
  it.each<DesktopReleasePlatform>(['macos-arm64', 'macos-x64', 'windows-x64'])(
    'accepts the exact %s feed and artifact set',
    async (platform) => {
      const value = await fixture(platform)

      await expect(
        verifyDesktopUpdateMetadata(value.directory, value.platform, version),
      ).resolves.toBeUndefined()
    },
  )

  it('rejects a primary path that does not name the updater artifact', async () => {
    const value = await fixture('macos-arm64')
    value.feed.path = `DeepSeek-Harness-${version}-mac-arm64.dmg`
    await writeFeed(value)

    await expect(
      verifyDesktopUpdateMetadata(value.directory, value.platform, version),
    ).rejects.toThrow('primary path or digest differs')
  })

  it('rejects a files entry whose size or digest differs from disk', async () => {
    const value = await fixture('windows-x64')
    const [entry] = value.feed.files as Array<Record<string, unknown>>
    if (entry === undefined) throw new Error('fixture must include its installer')
    entry.size = Number(entry.size) + 1
    entry.sha512 = 'stale'
    await writeFeed(value)

    await expect(
      verifyDesktopUpdateMetadata(value.directory, value.platform, version),
    ).rejects.toThrow('digest or size differs')
  })

  it('rejects extra release files before artifact upload', async () => {
    const value = await fixture('macos-x64')
    await writeFile(join(value.directory, 'unexpected.blockmap'), 'unexpected')

    await expect(
      verifyDesktopUpdateMetadata(value.directory, value.platform, version),
    ).rejects.toThrow('desktop update files differ')
  })
})
