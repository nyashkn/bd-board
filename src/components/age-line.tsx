import { formatAge } from '@/lib/age'
import { cn } from '@/lib/utils'

import type { Bead } from '@/lib/types'

/** One muted line: "created 12d ago · updated 3h ago", full ISO in the tooltip. */
export function AgeLine({
  bead,
  className,
}: {
  bead: Pick<Bead, 'created_at' | 'updated_at'>
  className?: string
}) {
  const now = Date.now()
  const created = formatAge(bead.created_at, now)
  const updated = formatAge(bead.updated_at, now)
  if (!created && !updated) return null
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
    </span>
  )
}
