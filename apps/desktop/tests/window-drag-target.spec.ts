// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { isWindowDragTarget, WINDOW_DRAG_ZONE_ATTRIBUTE } from '../src/window-drag-target.ts'

afterEach(() => { document.body.replaceChildren() })

function dragZone(content: string): HTMLElement {
  const root = document.createElement('div')
  root.setAttribute(WINDOW_DRAG_ZONE_ATTRIBUTE, '')
  root.innerHTML = content
  document.body.append(root)
  return root
}

describe('desktop window drag targets', () => {
  it('accepts an empty descendant of the drag zone', () => {
    const root = dragZone('<div id="blank"></div>')

    expect(isWindowDragTarget(root.querySelector('#blank'))).toBe(true)
  })

  it('leaves text and its containing element available for selection', () => {
    const root = dragZone('<div id="message">copy this text</div>')

    expect(isWindowDragTarget(root.querySelector('#message'))).toBe(false)
  })

  it('does not claim controls inside the drag zone', () => {
    const root = dragZone('<button id="copy">Copy</button>')

    expect(isWindowDragTarget(root.querySelector('#copy'))).toBe(false)
  })

  it('does not claim blank elements outside the application drag zone', () => {
    const other = document.createElement('div')
    document.body.append(other)

    expect(isWindowDragTarget(other)).toBe(false)
  })
})
