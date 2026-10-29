/** Search keys that describe "what I am looking at" and should survive view and project switches. */
export const VIEW_KEYS = ['q', 'p', 'l', 'closed', 'view', 'sort', 'nested']
/** Keys that only make sense inside one project (label sets differ between projects). */
const PROJECT_LOCAL = new Set(['l'])

type Search = Record<string, unknown>

/** The shared search state of `prev` (never `bead`/`k`/`tab`), with `patch` laid over it; `undefined` removes a key. */
export function carrySearch(
  prev: Search,
  patch: Search = {},
  keys: string[] = VIEW_KEYS,
): Search {
  const out: Search = {}
  for (const key of keys) if (prev[key] !== undefined) out[key] = prev[key]
  for (const [key, value] of Object.entries(patch))
    if (value === undefined) delete out[key]
    else out[key] = value
  return out
}

/** Search to carry to another project: the same view state minus keys that are project-specific. */
export function carryToProject(prev: Search): Search {
  return carrySearch(
    prev,
    {},
    VIEW_KEYS.filter((k) => !PROJECT_LOCAL.has(k)),
  )
}

/** Quick-filter links keep the view state (and the other quick filters) and set their own key. */
export function quickFilterSearch(prev: Search, patch: Search): Search {
  return carrySearch(prev, patch, [...VIEW_KEYS, 'ready', 'assignee'])
}

/**
 * How to close a bead opened at history index `base` while now at `current`:
 * a positive number means history.go(-n) (pop what the modal pushed), 0 means replace the URL
 * (page loaded with ?bead= or nothing of ours to pop).
 */
export function closeSteps(base: number | null, current: number): number {
  return base === null || current <= base ? 0 : current - base
}

/** Index of the current history entry as TanStack Router stamps it (0 when unknown). */
export function historyIndex(): number {
  try {
    const i = (window.history.state as { __TSR_index?: unknown } | null)
      ?.__TSR_index
    return typeof i === 'number' ? i : 0
  } catch {
    return 0
  }
}
