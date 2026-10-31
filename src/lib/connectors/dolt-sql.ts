import { Channel, invoke } from '@tauri-apps/api/core'

import { tracked } from '../rum.ts'
import { selectBoard, selectDetail, selectKnowledge } from '../snapshot.ts'
import { toErrorMessage } from '../utils.ts'
import { bdCli } from './bd-cli.ts'

import type { ProjectSnapshot } from '../snapshot.ts'
import type { BeadFeedMessage, Comment } from '../types.ts'
import type { Connector } from './types.ts'

// Desktop only: the Rust side holds the MySQL connection (one per project) and picks the server
// from the registry `sources` or `bd dolt show`, so the webview never names a host. Reads only;
// every write, the artifact reader and the author lookup stay on bd.
const snapshot = tracked(
  'dolt_snapshot',
  ({ data }: { data: { project: string; background?: boolean } }) =>
    invoke<ProjectSnapshot>('dolt_sql_snapshot', {
      projectId: data.project,
      background: data.background === true,
    }),
)

const beadComments = tracked(
  'dolt_comments',
  ({ data }: { data: { project: string; id: string; background?: boolean } }) =>
    invoke<Comment[]>('dolt_sql_comments', {
      projectId: data.project,
      id: data.id,
      background: data.background === true,
    }),
)

/** The change probe: `Live` once connected, then one `Change` each time the head hash moves. */
function subscribeFeed(
  project: string,
  _since: number,
  onMessage: (msg: BeadFeedMessage) => void,
): () => void {
  let closed = false
  const channel = new Channel<BeadFeedMessage>()
  channel.onmessage = (msg) => {
    if (!closed) onMessage(msg)
  }
  let watchId: number | null = null
  invoke<number>('watch_dolt_feed', { projectId: project, onMessage: channel })
    .then((id) => {
      if (closed) invoke('unwatch_dolt_feed', { watchId: id }).catch(() => {})
      else watchId = id
    })
    .catch((err) => {
      if (!closed)
        onMessage({
          type: 'error',
          message: toErrorMessage(err, 'Live updates unavailable'),
        })
    })
  return () => {
    closed = true
    if (watchId !== null)
      invoke('unwatch_dolt_feed', { watchId }).catch(() => {})
  }
}

export const doltSql: Connector = {
  ...bdCli,
  id: 'dolt-sql',
  snapshot,
  beadComments,
  listBeads: async (a) => selectBoard(await snapshot(a)),
  beadDetail: async (a) => {
    const detail = selectDetail(await snapshot(a), a.data.id)
    if (!detail) throw new Error(`bead ${a.data.id} not found`)
    return detail
  },
  projectKnowledge: async (a) => selectKnowledge(await snapshot(a)),
  subscribeFeed,
}
