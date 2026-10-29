// Lane collapse survives a reload (localStorage); scroll survives a view switch (sessionStorage).
// Both are keyed by project and every access is wrapped: storage may be unavailable.

type Kind = 'local' | 'session'

function store(kind: Kind): Storage | undefined {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return undefined
  }
}

const key = (name: string, project: string) => `bd-board:${name}:${project}`

/** Lane keys the user collapsed. */
export function readCollapsed(
  project: string,
  s: Pick<Storage, 'getItem'> | undefined = store('local'),
): Set<string> {
  try {
    const parsed: unknown = JSON.parse(
      s?.getItem(key('lanes-collapsed', project)) ?? '[]',
    )
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === 'string')
        : [],
    )
  } catch {
    return new Set()
  }
}

export function writeCollapsed(
  project: string,
  collapsed: Set<string>,
  s: Pick<Storage, 'setItem'> | undefined = store('local'),
): void {
  try {
    s?.setItem(key('lanes-collapsed', project), JSON.stringify([...collapsed]))
  } catch {
    // storage full or blocked: lanes just start open next time
  }
}

export function readScroll(
  project: string,
  tab: string,
  s: Pick<Storage, 'getItem'> | undefined = store('session'),
): number {
  try {
    const n = Number(s?.getItem(key(`scroll-${tab}`, project)))
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

export function writeScroll(
  project: string,
  tab: string,
  top: number,
  s: Pick<Storage, 'setItem'> | undefined = store('session'),
): void {
  try {
    s?.setItem(key(`scroll-${tab}`, project), String(Math.round(top)))
  } catch {
    // ignore
  }
}
