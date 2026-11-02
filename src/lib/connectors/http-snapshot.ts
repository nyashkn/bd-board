import { getHttpSnapshotFn } from '../server.ts'
import { selectBoard, selectDetail, selectKnowledge } from '../snapshot.ts'
import { toErrorMessage } from '../utils.ts'

import type { Connector } from './types.ts'

/** How often the open project's manifest is checked (a 304 costs almost nothing). */
export const POLL_MS = 30_000

const READ_ONLY =
  'this project is read-only (http-snapshot source): writes are refused'
// Not a connection error (see isConnectionError), so the router neither falls back nor retries.
const refuse = (): Promise<never> => Promise.reject(new Error(READ_ONLY))

/**
 * Read-only connector over a snapshot Worker. The fetch, the token and the verification all run in
 * `getHttpSnapshotFn` (server side); this only shapes the snapshot for the UI and polls for change.
 */
export function httpSnapshotConnector(
  source: string,
  fetchSnapshot: typeof getHttpSnapshotFn = getHttpSnapshotFn,
  pollMs = POLL_MS,
): Connector {
  const load = async (project: string) => {
    const { snapshot } = await fetchSnapshot({ data: { project, source } })
    if (!snapshot) throw new Error('snapshot source returned no snapshot')
    return snapshot
  }
  return {
    id: 'http-snapshot',
    listBeads: async ({ data }) => selectBoard(await load(data.project)),
    beadDetail: async ({ data }) => {
      const detail = selectDetail(await load(data.project), data.id)
      if (!detail) throw new Error(`bead not found: ${data.id}`)
      return detail
    },
    projectKnowledge: async ({ data }) =>
      selectKnowledge(await load(data.project)),
    snapshot: ({ data }) => load(data.project),
    beadComments: async ({ data }) =>
      (await load(data.project)).beads.find((b) => b.id === data.id)
        ?.comments ?? [],
    readArtifact: () =>
      Promise.reject(
        new Error('artifacts are not available over http-snapshot'),
      ),
    commentAuthor: () => refuse(),
    addComment: () => refuse(),
    updateStatus: () => refuse(),
    updateBead: () => refuse(),
    createBead: () => refuse(),
    previewDelete: () => refuse(),
    deleteBead: () => refuse(),
    enableEventsJournal: () => refuse(),
    // The change signal: poll the manifest. A new head becomes a full refresh (no op detail).
    subscribeFeed: (project, since, onMessage) => {
      let closed = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let head: string | undefined
      let seq = since
      const tick = async () => {
        try {
          const { cursor } = await fetchSnapshot({
            data: { project, source, peek: true },
          })
          if (closed) return
          if (head === undefined) onMessage({ type: 'live', seq })
          else if (cursor !== head)
            onMessage({ type: 'change', seq: ++seq, issueIds: [] })
          head = cursor
        } catch (err) {
          if (closed) return
          const message = toErrorMessage(err, 'Snapshot source unreachable')
          // A rejected token will not fix itself: say so once instead of retrying forever.
          onMessage(
            /token rejected/.test(message)
              ? { type: 'unsupported', message }
              : { type: 'error', message },
          )
          return
        }
        timer = setTimeout(tick, pollMs)
      }
      void tick()
      return () => {
        closed = true
        clearTimeout(timer)
      }
    },
  }
}
