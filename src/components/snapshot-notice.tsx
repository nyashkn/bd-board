import { useQuery } from '@tanstack/react-query'

import { formatAge } from '@/lib/age'
import { connectorFor } from '@/lib/core'
import { snapshotQueryOptions } from '@/lib/snapshot-store'

import type { ProjectSnapshot } from '@/lib/snapshot'

const readinessGap = (s: ProjectSnapshot) => s.readiness_unavailable === true

/**
 * Two small notes under the toolbar: the source could not be reached and the board shows the last
 * snapshot (with its age), and the SQL reader had no bd to say what is ready or blocked.
 */
export function SnapshotNotice({ project }: { project: string }) {
  // Another observer of the snapshot: it never fetches (see snapshotQueryOptions), only reads.
  const q = useQuery({
    ...snapshotQueryOptions(project),
    select: readinessGap,
    retry: false,
  })
  const stale = q.isError && q.dataUpdatedAt > 0
  if (!stale && !q.data) return null
  const age = formatAge(new Date(q.dataUpdatedAt).toISOString(), Date.now())
  const hub = connectorFor(project).id === 'dolt-sql'
  return (
    <div
      role="status"
      className="text-muted-foreground flex flex-wrap gap-x-4 px-4 py-1 text-xs"
    >
      {stale ? (
        <span>
          {hub ? 'Hub unreachable' : 'Refresh failed'}, showing last snapshot (
          {age})
        </span>
      ) : null}
      {q.data ? (
        <span>Ready and blocked unavailable: no local bd for this project</span>
      ) : null}
    </div>
  )
}
