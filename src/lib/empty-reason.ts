import { buildChildrenMap } from './tree'
import { CLOSED_WINDOWS, isHiddenByWindow } from './closed-window'

import type { ClosedWindow } from './closed-window'
import type { Bead } from './types'

export type EmptyReason =
  | { kind: 'none' }
  /** Nothing in the project matches the filters at all. */
  | { kind: 'no-match' }
  /** Matches exist but every one is closed before the window; `options` reveal them. */
  | {
      kind: 'closed-hidden'
      hidden: number
      options: { window: ClosedWindow; shown: number }[]
    }

/**
 * Why a board built from `matches` + `closedWindow` is empty. `matches` is the
 * filter predicate (search, chips, assignee ...). Returns kind 'none' when
 * something is visible.
 */
export function explainEmpty(
  beads: Bead[],
  matches: (b: Bead) => boolean,
  closedWindow: ClosedWindow,
  now: number,
): EmptyReason {
  const matched = beads.filter(matches)
  if (matched.length === 0) return { kind: 'no-match' }
  const childrenMap = buildChildrenMap(beads)
  const visibleIn = (w: ClosedWindow) =>
    matched.filter((b) => !isHiddenByWindow(b, childrenMap, w, now)).length
  if (visibleIn(closedWindow) > 0) return { kind: 'none' }
  // Only windows wider than the current one can reveal anything; offer each that adds beads.
  const wider = CLOSED_WINDOWS.slice(CLOSED_WINDOWS.indexOf(closedWindow) + 1)
  const options = wider
    .map((window) => ({ window, shown: visibleIn(window) }))
    .filter((o, i, all) => o.shown > 0 && o.shown !== all[i - 1]?.shown)
  return { kind: 'closed-hidden', hidden: matched.length, options }
}
