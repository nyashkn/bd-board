import { useSince } from '@/components/since-band'
import { formatAge } from '@/lib/age'
import { cn } from '@/lib/utils'

import type { Bead } from '@/lib/types'

/** One muted line: "created 12d ago · updated 3h ago", full ISO in the tooltip. */
export function AgeLine({
  bead,
  className,
}: {
  bead: Pick<Bead, 'id' | 'created_at' | 'updated_at'>
  className?: string
}) {
  const now = Date.now()
  const { latestComment } = useSince()
  const created = formatAge(bead.created_at, now)
  const updated = formatAge(bead.updated_at, now)
  // A comment does not bump updated_at: say so when one is newer.
  const commentAt = latestComment.get(bead.id) ?? 0
  const commented =
    commentAt > Date.parse(bead.updated_at ?? '') || (commentAt > 0 && !updated)
      ? formatAge(new Date(commentAt).toISOString(), now)
      : ''
  if (!created && !updated && !commented) return null
  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-1.5 truncate text-[10.5px] leading-none text-muted-foreground tabular-nums',
        className,
      )}
    >
      {created ? (
        <span title={`Created ${bead.created_at}`}>created {created}</span>
      ) : null}
      {created && updated ? <span aria-hidden="true">·</span> : null}
      {updated ? (
        <span title={`Updated ${bead.updated_at}`}>updated {updated}</span>
      ) : null}
      {commented ? (
        <>
          <span aria-hidden="true">·</span>
          <span title="Latest comment (comments do not change updated)">
            commented {commented}
          </span>
        </>
      ) : null}
    </span>
  )
}
