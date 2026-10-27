import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

import type { DescendantStats } from '@/lib/epics'

const SEGMENTS = [
  { key: 'closed', className: 'bg-status-closed' },
  { key: 'in_progress', className: 'bg-status-progress' },
  { key: 'blocked', className: 'bg-status-blocked' },
  { key: 'open', className: 'bg-status-open' },
] as const

/** Thin segmented bar + "closed/total · pct%"; breakdown and "took" in the tooltip/text. */
export function EpicProgress({
  stats,
  complete = false,
  took,
  className,
}: {
  stats: DescendantStats
  complete?: boolean
  /** Formatted duration for a completed epic, e.g. "5d". */
  took?: string
  className?: string
}) {
  const { total, closed, percent } = stats
  const breakdown = `${stats.open} open · ${stats.in_progress} in progress · ${stats.blocked} blocked`
  if (total === 0 && !complete) return null
  return (
    <span
      className={cn('flex shrink-0 items-center gap-2', className)}
      title={
        complete ? `Done${took ? ` · took ${took}` : ''}` : breakdown
      }
    >
      {total > 0 ? (
        <span
          className="hidden h-1 w-16 overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-foreground/5 sm:flex"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={`${percent}% complete`}
        >
          {SEGMENTS.filter((s) => stats[s.key] > 0).map((s) => (
            <span
              key={s.key}
              className={cn('h-full', s.className)}
              style={{ width: `${(stats[s.key] / total) * 100}%` }}
            />
          ))}
        </span>
      ) : null}
      <span
        className={cn(
          'font-mono text-[11px] tabular-nums',
          complete ? 'text-status-closed' : 'text-muted-foreground',
        )}
      >
        {total > 0 ? `${closed}/${total} · ${percent}%` : null}
      </span>
      {complete ? (
        <span className="inline-flex items-center gap-1 rounded-[4px] bg-status-closed/16 px-1.5 py-px text-[10px] font-semibold tracking-[0.06em] text-status-closed uppercase">
          <Check className="size-2.5" aria-hidden="true" />
          Done{took ? ` · took ${took}` : ''}
        </span>
      ) : (
        <span className="hidden text-[10.5px] text-muted-foreground lg:inline">
          {breakdown}
        </span>
      )}
    </span>
  )
}
