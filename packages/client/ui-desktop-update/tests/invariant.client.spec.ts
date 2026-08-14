import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as DesktopUpdateInvariant from '../src/invariant.ts'

describe('ui-desktop-update invariant companion', () => {
  it('registers the package-owned explained-empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    expect(DesktopUpdateInvariant.name).toBe('client-ui-desktop-update-invariant')
    expect(DesktopUpdateInvariant.inject).toEqual(['invariants'])
    await expect(ctx.plugin(DesktopUpdateInvariant).await()).resolves.toBeDefined()
  })
})
