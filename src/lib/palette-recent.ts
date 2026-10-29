/** The palette's "Recent" list: the last beads opened, newest first, kept in localStorage. */

export interface RecentEntry {
  project: string
  id: string
}

export const RECENT_KEY = 'bd-board:palette-recent'
export const MAX_RECENT = 8

export function pushRecent(
  list: RecentEntry[],
  entry: RecentEntry,
  max = MAX_RECENT,
): RecentEntry[] {
  const rest = list.filter(
    (e) => !(e.project === entry.project && e.id === entry.id),
  )
  return [entry, ...rest].slice(0, max)
}

/** Tolerates anything in storage: bad JSON, wrong shapes, too many rows. */
export function parseRecent(raw: string | null): RecentEntry[] {
  if (!raw) return []
  try {
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    const out: RecentEntry[] = []
    for (const item of data) {
      const { project, id } = (item ?? {}) as Record<string, unknown>
      if (
        typeof project === 'string' &&
        typeof id === 'string' &&
        project &&
        id
      )
        out.push({ project, id })
    }
    return out.slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

export function loadRecent(): RecentEntry[] {
  try {
    return parseRecent(localStorage.getItem(RECENT_KEY))
  } catch {
    return []
  }
}

export function recordRecent(entry: RecentEntry): RecentEntry[] {
  const next = pushRecent(loadRecent(), entry)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // storage unavailable: the list just does not persist
  }
  return next
}
