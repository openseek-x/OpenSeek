/** Verify the GitHub release tag against the desktop package manifest. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertDesktopReleaseTag } from './release-tag.ts'

const manifestPath = resolve(import.meta.dirname, '../package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
if (typeof manifest.version !== 'string') throw new TypeError(`${manifestPath} must declare a string version`)

const tag = process.env.RELEASE_TAG
if (tag === undefined) throw new Error('RELEASE_TAG is required for a tagged desktop release')

assertDesktopReleaseTag(tag, manifest.version)
