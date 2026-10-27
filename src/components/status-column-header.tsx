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

/** "Show 240 closed before Oct 21" as a real button; nothing when no closed bead is hidden. */
export function ClosedHiddenNote({
  hidden,
  onShowAll,
  before,
}: {
  hidden: number
  onShowAll: () => void
  /** Start of the closed window (ms), for the date in the label. */
  before?: number
}) {
  if (hidden <= 0) return null
  const date =
    before !== undefined && Number.isFinite(before)
      ? new Date(before).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        })
      : ''
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      onClick={onShowAll}
      className="h-6 w-fit max-w-full justify-start text-xs text-muted-foreground hover:text-foreground"
    >
      <span className="truncate">
        Show {hidden} closed{date ? ` before ${date}` : ' earlier'}
      </span>
    </Button>
  )
}
