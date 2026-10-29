import { useMemo, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'

import { BeadCard } from '@/components/bead-card'
import {
  ClosedHiddenNote,
  StatusColumnHeader,
} from '@/components/status-column-header'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

import type { Bead, BeadColumn } from '@/lib/types'

interface KanbanColumnProps {
  column: BeadColumn
  label: string
  beads: Bead[]
  initialLimit?: number
  nested?: boolean
  /** Closed column only: how many closed beads exist before the recency window. */
  total?: number
  onShowAll?: () => void
  /** Start of the closed window (ms), for the "before Oct 21" label. */
  closedBefore?: number
}

export function KanbanColumn({
  column,
  label,
  beads,
  initialLimit = 40,
  nested = false,
  total,
  onShowAll,
  closedBefore,
}: KanbanColumnProps) {
  const [expanded, setExpanded] = useState(false)
  const { setNodeRef, isOver } = useDroppable({ id: column })

  const visible = useMemo(
    () => (expanded ? beads : beads.slice(0, initialLimit)),
    [beads, expanded, initialLimit],
  )
  const hidden = beads.length - visible.length
  const ids = useMemo(() => visible.map((b) => b.id), [visible])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <StatusColumnHeader
        column={column}
        label={label}
        count={beads.length}
        total={total}
        className={
          total !== undefined && total > beads.length ? 'mb-1' : 'mb-3'
        }
      />
      {total !== undefined && total > beads.length && onShowAll ? (
        <div className="mb-2">
          <ClosedHiddenNote
            hidden={total - beads.length}
            onShowAll={onShowAll}
            before={closedBefore}
          />
        </div>
      ) : null}

      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col rounded-[10px] bg-canvas ring-1 ring-inset ring-foreground/5 transition-colors',
          isOver && 'bg-primary/5 ring-primary/30',
        )}
      >
        {beads.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-4">
            <span className="font-mono text-[11px] text-foreground/22">—</span>
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-2 p-2">
              <SortableContext
                items={ids}
                strategy={verticalListSortingStrategy}
              >
                {visible.map((bead) => (
                  <BeadCard key={bead.id} bead={bead} nested={nested} />
                ))}
              </SortableContext>

              {hidden > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 w-full text-muted-foreground"
                  onClick={() => setExpanded(true)}
                >
                  Mostrar mais ({hidden})
                </Button>
              ) : null}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
