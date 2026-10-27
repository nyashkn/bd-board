import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { BeadColumn } from '@/lib/types'

interface StatusColumnHeaderProps {
  column: BeadColumn
  label: string
  count: number
  /** When larger than count, shown as "count of total" (older closed beads hidden). */
  total?: number
  /** Epics sitting in this column on the Epics board, where they are lane headers, not cards. */
  epics?: number
  className?: string
}

const DOT_CLASS: Record<BeadColumn, string> = {
  open: 'bg-status-open',
  in_progress: 'bg-status-progress',
  blocked: 'bg-status-blocked',
  closed: 'bg-status-closed',
}

const COUNT_CLASS: Record<BeadColumn, string> = {
  open: 'text-status-open',
  in_progress: 'text-status-progress',
  blocked: 'text-status-blocked',
  closed: 'text-status-closed',
}

export function StatusColumnHeader({
  column,
  label,
  count,
  total,
  epics = 0,
  className,
}: StatusColumnHeaderProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-[8px] bg-canvas px-2.5 py-[7px] ring-1 ring-inset ring-border',
        className,
      )}
    >
      <span
        className={cn('size-[7px] shrink-0 rounded-full', DOT_CLASS[column])}
        aria-hidden="true"
      />
      <h2 className="truncate text-[12.5px] font-semibold tracking-[-0.005em] text-foreground">
        {label}
      </h2>
      <span
        className={cn(
          'ml-auto font-mono text-[11.5px] font-medium tabular-nums',
          COUNT_CLASS[column],
        )}
      >
        {total !== undefined && total > count ? `${count} of ${total}` : count}
      </span>
      {epics > 0 ? (
        <span
          className="font-mono text-[10.5px] text-muted-foreground tabular-nums"
          title={`${epics} ${epics === 1 ? 'epic is' : 'epics are'} in this column too (shown as lanes)`}
        >
          +{epics} {epics === 1 ? 'epic' : 'epics'}
        </span>
      ) : null}
    </div>
  )
}

/** "253 older hidden, show all"; nothing when no closed bead is hidden. */
export function ClosedHiddenNote({
  hidden,
  onShowAll,
}: {
  hidden: number
  onShowAll: () => void
}) {
  if (hidden <= 0) return null
  return (
    <Button
      type="button"
      variant="link"
      onClick={onShowAll}
      className="h-auto justify-start px-2.5 py-0 text-[11px] text-muted-foreground hover:text-foreground"
    >
      {hidden} older hidden, show all
    </Button>
  )
}
