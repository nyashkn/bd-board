/** Keyboard model: pure decisions, wired up in `use-board-keys.ts`. */

export interface KeyLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  target?: { tagName?: string; isContentEditable?: boolean } | null
}

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** True while the user is typing: shortcuts must stay out of the way. */
export function isTyping(target: KeyLike['target']): boolean {
  return Boolean(
    target && (TYPING.has(target.tagName ?? '') || target.isContentEditable),
  )
}

export type KeyAction =
  | { type: 'move'; delta: 1 | -1 }
  | { type: 'open' }
  | { type: 'focus-search' }
  | { type: 'help' }

/**
 * Esc is left to the dialogs themselves. Everything else is ignored while typing, with a
 * modifier held, or while a dialog is open (`blocked`).
 */
export function keyAction(e: KeyLike, blocked = false): KeyAction | null {
  if (blocked || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target))
    return null
  switch (e.key) {
    case 'j':
    case 'ArrowDown':
      return { type: 'move', delta: 1 }
    case 'k':
    case 'ArrowUp':
      return { type: 'move', delta: -1 }
    case 'Enter':
      return { type: 'open' }
    case '/':
      return { type: 'focus-search' }
    case '?':
      return { type: 'help' }
    default:
      return null
  }
}

/** Next index in a list of `count` rows, clamped (no wrap); -1 means nothing selected yet. */
export function stepIndex(
  current: number,
  delta: 1 | -1,
  count: number,
): number {
  if (count <= 0) return -1
  if (current < 0) return delta === 1 ? 0 : count - 1
  return Math.min(count - 1, Math.max(0, current + delta))
}

export const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: 'j  /  ↓', does: 'Next bead' },
  { keys: 'k  /  ↑', does: 'Previous bead' },
  { keys: 'Enter', does: 'Open the selected bead' },
  { keys: 'Esc', does: 'Close the bead or this list' },
  { keys: '/', does: 'Search' },
  { keys: '?', does: 'Show this list' },
]
