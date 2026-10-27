import { completedAt, isComplete } from './epics'

import type { Bead } from './types'

export const CLOSED_WINDOWS = ['1d', '7d', '30d', '90d', 'all'] as const
export type ClosedWindow = (typeof CLOSED_WINDOWS)[number]
export const DEFAULT_CLOSED_WINDOW: ClosedWindow = '7d'

const DAY = 86_400_000
const STORAGE_KEY = 'bd-board:closed-window'

export function parseClosedWindow(value: unknown): ClosedWindow | undefined {
  return (CLOSED_WINDOWS as readonly string[]).includes(value as string)
    ? (value as ClosedWindow)
    : undefined
}

/** Oldest closed_at still shown, in epoch ms; -Infinity for "all". */
export function windowCutoff(window: ClosedWindow, now: number): number {
  return window === 'all' ? -Infinity : now - Number.parseInt(window, 10) * DAY
}

/**
 * True when a finished bead (or finished epic subtree) closed before the
 * window. Anything with unfinished work under it is never hidden, so hiding
 * can't lose open beads. Closed time is closed_at, falling back to updated_at;
 * no usable timestamp means shown.
 */
export function isHiddenByWindow(
  bead: Bead,
  childrenMap: Map<string, Bead[]>,
  window: ClosedWindow,
  now: number,
): boolean {
  if (window === 'all' || !isComplete(bead, childrenMap)) return false
  const at = completedAt(bead, childrenMap)
  return at !== undefined && at < windowCutoff(window, now)
}

export function readStoredClosedWindow(): ClosedWindow | undefined {
  try {
    return parseClosedWindow(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return undefined
  }
}

export function storeClosedWindow(value: ClosedWindow): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // storage unavailable (private mode, blocked): the URL still carries the choice
  }
}
