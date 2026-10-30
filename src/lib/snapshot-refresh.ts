/**
 * Paces the feed-driven snapshot refresh. Single-flight (one running plus one trailing), debounced,
 * and the next run starts no sooner than the last one took after it ended, so a burst of agent
 * writes keeps the bd lock under half busy. A change whose ops are all `comment` fetches just
 * those beads' comments; any other or unknown op runs a full snapshot.
 */
export const REFRESH_DEBOUNCE_MS = 300
/** A sustained burst still refreshes at least this often. */
export const REFRESH_MAX_WAIT_MS = 1000

export interface RefreshJobs {
  full: () => Promise<unknown>
  comments: (ids: string[]) => Promise<unknown>
}

export interface FeedChange {
  issueIds: string[]
  ops?: string[]
}

export interface Refresher {
  /** A change event from the feed. */
  change: (change: FeedChange) => void
  /** A full refresh, still paced (the feed went live, or reconnected). */
  full: () => void
  dispose: () => void
}

export function createRefresher(
  jobs: RefreshJobs,
  debounceMs = REFRESH_DEBOUNCE_MS,
): Refresher {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let wantFull = false
  let disposed = false
  const commentIds = new Set<string>()
  let earliest = 0
  // When the oldest unrefreshed change arrived; caps how long the debounce can keep deferring.
  let burstStart = 0

  const pending = () => wantFull || commentIds.size > 0

  const arm = (ms: number) => {
    clearTimeout(timer)
    timer = setTimeout(flush, ms)
  }

  async function flush() {
    timer = undefined
    // The running job re-arms on completion if anything is still pending.
    if (running || disposed || !pending()) return
    burstStart = 0
    const wait = earliest - Date.now()
    if (wait > 0) return arm(wait)
    running = true
    const started = Date.now()
    const job = wantFull ? jobs.full() : jobs.comments([...commentIds])
    wantFull = false
    commentIds.clear()
    try {
      await job
    } catch {
      // refreshes report their own errors; the next event retries
    }
    const now = Date.now()
    earliest = now + (now - started)
    running = false
    if (pending()) arm(0)
  }

  return {
    change({ issueIds, ops }) {
      if (ops?.length && issueIds.length && ops.every((o) => o === 'comment')) {
        for (const id of issueIds) commentIds.add(id)
      } else {
        wantFull = true
      }
      burstStart ||= Date.now()
      arm(
        Math.min(
          debounceMs,
          Math.max(0, burstStart + REFRESH_MAX_WAIT_MS - Date.now()),
        ),
      )
    },
    full() {
      wantFull = true
      arm(0)
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
    },
  }
}
