import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { explainEmpty } from '@/lib/empty-reason'
import { windowCutoff } from '@/lib/closed-window'

import type { ClosedWindow } from '@/lib/closed-window'
import type { Bead } from '@/lib/types'

const windowLabel = (w: ClosedWindow) =>
  w === 'all' ? 'all time' : `the last ${w}`

/** An empty board that says why, with the one-click fix. */
export function EmptyBoard({
  beads,
  matches,
  closedWindow,
  now,
  onSetClosedWindow,
  onClearFilters,
}: {
  beads: Bead[]
  /** The active filters as one predicate; null when none is set. */
  matches: ((b: Bead) => boolean) | null
  closedWindow: ClosedWindow
  now: number
  onSetClosedWindow: (w: ClosedWindow) => void
  onClearFilters?: () => void
}) {
  const reason = useMemo(
    () => explainEmpty(beads, matches ?? (() => true), closedWindow, now),
    [beads, matches, closedWindow, now],
  )

  if (reason.kind === 'closed-hidden') {
    const date = new Date(windowCutoff(closedWindow, now)).toLocaleDateString(
      undefined,
      { month: 'short', day: 'numeric' },
    )
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center"
        role="status"
      >
        <p className="text-sm text-muted-foreground">
          {reason.hidden} matching{' '}
          {reason.hidden === 1 ? 'bead is' : 'beads are'} closed before {date},
          outside the closed window ({closedWindow}).
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {reason.options.map((o) => (
            <Button
              key={o.window}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onSetClosedWindow(o.window)}
            >
              Show closed from {windowLabel(o.window)} ({o.shown})
            </Button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center"
      role="status"
    >
      <p className="text-sm text-muted-foreground">
        {matches ? 'No beads match the filters' : 'No beads in this project'}
      </p>
      {matches && onClearFilters ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClearFilters}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  )
}
