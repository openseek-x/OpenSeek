import type {
  DesktopUpdateState,
  DesktopUpdateStateBase,
} from '../src/protocol.ts'

export const UPDATE_BASE = {
  revision: 1,
  currentVersion: '1.0.0',
  policy: 'background',
  releaseUrl: 'https://github.com/openseek-x/OpenSeek/releases',
} satisfies DesktopUpdateStateBase

type WithoutBase<T> = T extends DesktopUpdateState
  ? Omit<T, keyof DesktopUpdateStateBase>
  : never

/** Build one complete updater state with deterministic common fields. */
export function updateState(
  body: WithoutBase<DesktopUpdateState>,
  base: Partial<DesktopUpdateStateBase> = {},
): DesktopUpdateState {
  return { ...UPDATE_BASE, ...base, ...body }
}
