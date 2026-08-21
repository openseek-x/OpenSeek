/** Renderer-side ownership check for the blank regions that may move the native window. */

/** Attribute marking the application subtree whose blank regions support native-window dragging. */
export const WINDOW_DRAG_ZONE_ATTRIBUTE = 'data-dsh-desktop-window-drag-zone'

const INTERACTIVE_WINDOW_DRAG_TARGET = [
  'a[href]',
  'area[href]',
  'audio[controls]',
  'button',
  'iframe',
  'input',
  'label',
  'select',
  'summary',
  'textarea',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[draggable="true"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="treeitem"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * Decide whether a pointer begins in an empty native-window drag region.
 * @param target - Browser event target.
 * @returns Whether the target can own a native-window drag without blocking text selection or a control.
 */
export function isWindowDragTarget(target: EventTarget | null): target is Element {
  if (!(target instanceof Element)) return false
  if (target.closest(INTERACTIVE_WINDOW_DRAG_TARGET) !== null) return false
  if (target.textContent?.trim() !== '') return false
  return target === document.body
    || target === document.documentElement
    || target.closest(`[${WINDOW_DRAG_ZONE_ATTRIBUTE}]`) !== null
}
