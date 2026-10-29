import { useMemo, useState } from 'react'
import { useScrollMemory } from '@/hooks/use-scroll-memory'
import { readCollapsed, writeCollapsed } from '@/lib/view-state'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { ChevronDown, ChevronRight, Layers } from 'lucide-react'

import { BeadCard } from '@/components/bead-card'
import { EpicProgress } from '@/components/epic-progress'
import {
  ClosedHiddenNote,
  StatusColumnHeader,
} from '@/components/status-column-header'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatSpan } from '@/lib/age'
import { shortId } from '@/lib/hierarchy'
import { beadColumn, isEpic } from '@/lib/types'
import { descendantStats, epicTook, isCompleteEpic } from '@/lib/epics'
import { buildChildrenMap } from '@/lib/tree'
import { isHiddenByWindow, windowCutoff } from '@/lib/closed-window'
import {
  PRIORITIES,
  PRIORITY_TEXT_CLASS,
  PRIORITY_WORD,
  beadMatches,
  keepEpicLane,
  compareBeads,
} from '@/lib/sort'

import type { ReactNode } from 'react'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { ClosedWindow } from '@/lib/closed-window'
import type { DescendantStats } from '@/lib/epics'
import type { SortKey } from '@/lib/sort'
import type { Bead, BeadColumn } from '@/lib/types'

export type SwimlaneGroup = 'epic' | 'priority'

interface BoardSwimlanesProps {
  project: string
  beads: Bead[]
  search: string
  priorities: number[]
  ready: boolean
  assignee: string
  labels: string[]
  sort: SortKey
  groupBy: SwimlaneGroup
  nested?: boolean
  closedWindow: ClosedWindow
  now: number
  onShowAllClosed: () => void
  onOpen: (bead: Bead) => void
  applyDrop: (activeId: string, toColumn: BeadColumn) => void
}

const PRIORITY_HINT: Record<number, string> = {
  0: 'highest',
  4: 'lowest',
}

const COLUMN_KEYS: BeadColumn[] = ['open', 'in_progress', 'blocked', 'closed']

const COLUMN_LABEL: Record<BeadColumn, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  closed: 'Closed',
}

function emptyByColumn(): Record<BeadColumn, Bead[]> {
  return { open: [], in_progress: [], blocked: [], closed: [] }
}

function groupByColumn(
  beads: Bead[],
  compare: (a: Bead, b: Bead) => number,
): Record<BeadColumn, Bead[]> {
  const grouped = emptyByColumn()
  for (const b of beads) grouped[beadColumn(b)].push(b)
  for (const key of COLUMN_KEYS) grouped[key].sort(compare)
  return grouped
}

function LaneCell({
  column,
  beads,
  onOpen,
  nested,
}: {
  column: BeadColumn
  beads: Bead[]
  onOpen: (bead: Bead) => void
  nested: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column })
  const ids = useMemo(() => beads.map((b) => b.id), [beads])

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-19 min-w-0 flex-col gap-2 rounded-[10px] bg-canvas p-2 ring-1 ring-inset ring-foreground/5 transition-colors',
        isOver && 'bg-primary/5 ring-primary/30',
      )}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {beads.map((bead) => (
          <BeadCard key={bead.id} bead={bead} onOpen={onOpen} nested={nested} />
        ))}
      </SortableContext>
      {beads.length === 0 ? (
        <span className="flex flex-1 items-center justify-center py-3 font-mono text-[11px] text-foreground/22">
          —
        </span>
      ) : null}
    </div>
  )
}

function SwimLane({
  epic,
  title,
  childBeads,
  sort,
  nested,
  progress,
  scopedOnly = false,
  onOpen,
  applyDrop,
  open,
  onToggle,
}: {
  epic?: Bead
  title?: ReactNode
  childBeads: Bead[]
  sort: SortKey
  nested: boolean
  progress?: { stats: DescendantStats; complete: boolean; took: string }
  /** Epic with no tasks yet: header only, nothing to lay out in columns. */
  scopedOnly?: boolean
  onOpen: (bead: Bead) => void
  applyDrop: (activeId: string, toColumn: BeadColumn) => void
  open: boolean
  onToggle: () => void
}) {
  const [activeBead, setActiveBead] = useState<Bead | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const byColumn = useMemo(
    () => groupByColumn(childBeads, compareBeads(sort)),
    [childBeads, sort],
  )
  const beadsById = useMemo(() => {
    const map = new Map<string, Bead>()
    for (const b of childBeads) map.set(b.id, b)
    return map
  }, [childBeads])
  const done = byColumn.closed.length

  function columnOfId(id: string): BeadColumn | null {
    if ((COLUMN_KEYS as string[]).includes(id)) return id as BeadColumn
    const bead = beadsById.get(id)
    return bead ? beadColumn(bead) : null
  }

  function onDragStart(event: DragStartEvent) {
    const dragged = event.active.data.current?.bead as Bead | undefined
    setActiveBead(dragged ?? beadsById.get(String(event.active.id)) ?? null)
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveBead(null)
    const { active, over } = event
    if (!over) return
    const to = columnOfId(String(over.id))
    if (to) applyDrop(String(active.id), to)
  }

  return (
    <section className="flex flex-col gap-2">
      <header
        className={cn(
          'flex items-center gap-2 rounded-[8px] bg-canvas py-1.5 pr-2.5 pl-1.5 ring-1 ring-inset ring-border',
          progress?.complete && 'ring-status-closed/45',
        )}
      >
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? 'Collapse lane' : 'Expand lane'}
        >
          {open ? (
            <ChevronDown className="size-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4" aria-hidden="true" />
          )}
        </Button>

        {epic ? (
          <Button
            variant="link"
            onClick={() => onOpen(epic)}
            className="h-auto min-w-0 gap-2 p-0"
          >
            <Layers
              className="size-3.5 shrink-0 text-primary-text"
              aria-hidden="true"
            />
            <span className="font-mono text-[11px] text-muted-foreground">
              {epic.id}
            </span>
            <span className="truncate text-[13px] font-medium tracking-[-0.005em] text-foreground">
              {epic.title}
            </span>
          </Button>
        ) : (
          <span className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
            {title}
          </span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-3">
          {scopedOnly && epic ? (
            <ScopedSummary epic={epic} />
          ) : progress ? (
            <EpicProgress
              stats={progress.stats}
              complete={progress.complete}
              took={progress.took}
            />
          ) : (
            <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
              {done}/{childBeads.length}
            </span>
          )}
        </span>
      </header>

      {open && !scopedOnly ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveBead(null)}
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {COLUMN_KEYS.map((key) => (
              <LaneCell
                key={key}
                column={key}
                beads={byColumn[key]}
                onOpen={onOpen}
                nested={nested}
              />
            ))}
          </div>
          <DragOverlay>
            {activeBead ? (
              <BeadCard bead={activeBead} onOpen={() => {}} overlay />
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : null}
    </section>
  )
}

/** Progress summary of an epic with no tasks: "no tasks yet · waits on x · scoped 18d ago". */
function ScopedSummary({ epic }: { epic: Bead }) {
  const waiting = epic.waiting_on ?? []
  const born = epic.created_at
    ? formatSpan(Date.now() - Date.parse(epic.created_at))
    : ''
  return (
    <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
      <span className="rounded-[4px] border border-dashed border-border-strong px-1.5 py-px text-[10px] font-semibold tracking-[0.04em] uppercase">
        no tasks yet
      </span>
      {waiting.length > 0 ? (
        <span
          className="hidden font-mono text-warn sm:inline"
          title={`Waits on ${waiting.join(', ')}`}
        >
          waits {shortId(waiting[0])}
          {waiting.length > 1 ? ` +${waiting.length - 1}` : ''}
        </span>
      ) : null}
      <span className="hidden font-mono tabular-nums sm:inline">
        0/0{born ? ` · scoped ${born} ago` : ''}
      </span>
    </span>
  )
}

interface Lane {
  scopedOnly?: boolean
  key: string
  epic?: Bead
  title?: ReactNode
  children: Bead[]
  progress?: { stats: DescendantStats; complete: boolean; took: string }
}

export function BoardSwimlanes({
  project,
  beads,
  search,
  priorities,
  ready,
  assignee,
  labels,
  sort,
  groupBy,
  nested = false,
  closedWindow,
  now,
  onShowAllClosed,
  onOpen,
  applyDrop,
}: BoardSwimlanesProps) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(project))
  const scroll = useScrollMemory(project, 'board')
  function toggleLane(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      writeCollapsed(project, next)
      return next
    })
  }
  const { lanes, totals, epicTotals, closedTotal, hasAny } = useMemo(() => {
    const matches = (b: Bead) =>
      beadMatches(b, search, priorities, ready, assignee, labels)
    const epicIds = new Set(beads.filter(isEpic).map((e) => e.id))
    // In nested mode, children of a non-epic parent are pulled out of the
    // lane grid and shown inline inside their parent's card instead — but an
    // epic's direct children keep grouping into the epic's lane as usual,
    // since epics are lane headers here, not cards, and have nowhere to nest into.
    const isNestedAway = (b: Bead) =>
      nested && !!b.parent && !epicIds.has(b.parent)
    const work = beads.filter(
      (b) => !isEpic(b) && matches(b) && !isNestedAway(b),
    )

    const childrenMap = buildChildrenMap(beads)
    const hiddenIds = new Set(
      beads
        .filter((b) => isHiddenByWindow(b, childrenMap, closedWindow, now))
        .map((b) => b.id),
    )
    const shown = work.filter((b) => !hiddenIds.has(b.id))
    let builtLanes: Lane[]
    if (groupBy === 'priority') {
      builtLanes = PRIORITIES.map((p) => ({
        key: `p${p}`,
        title: (
          <>
            <span
              className={cn(
                'rounded-[4px] px-1.5 py-px font-mono text-[11px] font-semibold ring-1 ring-inset ring-current',
                PRIORITY_TEXT_CLASS[p],
              )}
            >
              P{p}
            </span>
            <span className="text-foreground">{PRIORITY_WORD[p]}</span>
            {PRIORITY_HINT[p] ? (
              <span className="text-[11.5px] text-faint">
                · {PRIORITY_HINT[p]}
              </span>
            ) : null}
          </>
        ),
        children: shown.filter((b) => b.priority === p),
      })).filter((lane) => lane.children.length > 0)
    } else {
      const epics = beads.filter(isEpic)

      const childrenByEpic = new Map<string, Bead[]>()
      for (const b of shown) {
        if (b.parent && epicIds.has(b.parent)) {
          const list = childrenByEpic.get(b.parent) ?? []
          list.push(b)
          childrenByEpic.set(b.parent, list)
        }
      }

      const epicOrder = [...epics].sort(compareBeads('priority'))
      const epicLanes = epicOrder
        .map((epic) => ({
          key: epic.id,
          epic,
          children: childrenByEpic.get(epic.id) ?? [],
          scopedOnly: !childrenMap.has(epic.id),
          progress: {
            stats: descendantStats(epic.id, childrenMap),
            complete: isCompleteEpic(epic, childrenMap),
            took: epicTook(epic, childrenMap),
          },
        }))
        .filter((lane) => !hiddenIds.has(lane.epic.id))
        .filter((lane) =>
          keepEpicLane(
            matches(lane.epic),
            labels.length > 0,
            lane.children.length,
            !childrenMap.has(lane.epic.id),
          ),
        )

      const orphans = shown.filter((b) => !b.parent || !epicIds.has(b.parent))

      builtLanes =
        orphans.length > 0
          ? [
              { key: 'no-epic', title: 'No epic', children: orphans },
              ...epicLanes,
            ]
          : epicLanes
    }

    // Epics are lane headers, not cards: say how many sit in each column so the column
    // counts can be reconciled with `bd` totals.
    const epicsByColumn = emptyByColumn()
    if (groupBy === 'epic')
      for (const e of beads)
        if (isEpic(e) && matches(e) && !hiddenIds.has(e.id))
          epicsByColumn[beadColumn(e)].push(e)

    const totalByColumn = emptyByColumn()
    for (const b of shown) totalByColumn[beadColumn(b)].push(b)
    const closedAll = work.filter((b) => beadColumn(b) === 'closed').length

    return {
      lanes: builtLanes,
      totals: totalByColumn,
      epicTotals: epicsByColumn,
      closedTotal: closedAll,
      hasAny: builtLanes.length > 0,
    }
  }, [
    beads,
    search,
    priorities,
    ready,
    assignee,
    labels,
    groupBy,
    nested,
    closedWindow,
    now,
  ])

  if (!hasAny) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted-foreground">
          No beads match the filters
        </span>
      </div>
    )
  }

  return (
    <div
      ref={scroll.ref}
      onScroll={scroll.onScroll}
      className="min-h-0 flex-1 overflow-y-auto pb-2"
    >
      <div className="sticky top-0 z-10 grid grid-cols-1 gap-3 bg-background/92 pt-3 pb-2.5 backdrop-blur-[8px] md:grid-cols-2 xl:grid-cols-4">
        {COLUMN_KEYS.map((key) => (
          <div key={key} className="flex min-w-0 flex-col gap-1">
            <StatusColumnHeader
              column={key}
              label={COLUMN_LABEL[key]}
              count={totals[key].length}
              epics={epicTotals[key].length}
              total={key === 'closed' ? closedTotal : undefined}
            />
            {key === 'closed' ? (
              <ClosedHiddenNote
                hidden={closedTotal - totals.closed.length}
                onShowAll={onShowAllClosed}
                before={windowCutoff(closedWindow, now)}
              />
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3.5">
        {lanes.map((lane) => (
          <SwimLane
            key={lane.key}
            epic={lane.epic}
            title={lane.title}
            childBeads={lane.children}
            sort={sort}
            nested={nested}
            progress={lane.progress}
            scopedOnly={lane.scopedOnly}
            onOpen={onOpen}
            applyDrop={applyDrop}
            open={!collapsed.has(lane.key)}
            onToggle={() => toggleLane(lane.key)}
          />
        ))}
      </div>
    </div>
  )
}
