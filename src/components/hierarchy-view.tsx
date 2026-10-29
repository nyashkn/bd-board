import { useEffect, useMemo, useState } from 'react'
import {
  Ban,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  CircleCheck,
  CircleDot,
  CirclePause,
  Hourglass,
  Layers,
  MessageSquare,
} from 'lucide-react'

import { EmptyBoard } from '@/components/empty-board'
import { EpicProgress } from '@/components/epic-progress'
import { ChangedDot, useSince } from '@/components/since-band'
import { Button } from '@/components/ui/button'
import { ClosedHiddenNote } from '@/components/status-column-header'
import { InteractiveRow } from '@/components/ui/interactive-row'
import { cn } from '@/lib/utils'
import { formatSpan } from '@/lib/age'
import { isEpic } from '@/lib/types'
import { PRIORITY_TEXT_CLASS } from '@/lib/sort'
import { buildChildrenMap, getRootBeads } from '@/lib/tree'
import { descendantStats, epicTook, isCompleteEpic } from '@/lib/epics'
import { isHiddenByWindow, windowCutoff } from '@/lib/closed-window'
import {
  ROW_STATE_LABEL,
  compareHierarchy,
  expandableIds,
  filterWithAncestors,
  initials,
  readExpanded,
  rowState,
  shortId,
  writeExpanded,
} from '@/lib/hierarchy'

import type { LucideIcon } from 'lucide-react'
import type { ClosedWindow } from '@/lib/closed-window'
import type { RowState } from '@/lib/hierarchy'
import type { Bead } from '@/lib/types'

interface HierarchyViewProps {
  project: string
  beads: Bead[]
  closedWindow: ClosedWindow
  now: number
  /** The Board's filters as one predicate; null when none is active. */
  matches: ((bead: Bead) => boolean) | null
  onSetClosedWindow: (w: ClosedWindow) => void
  onClearFilters: () => void
  onShowAllClosed: () => void
  onOpen: (bead: Bead) => void
}

// Shape and colour together, so the state survives grayscale.
const STATE_GLYPH: Record<RowState, { icon: LucideIcon; className: string }> = {
  open: { icon: Circle, className: 'text-status-open' },
  in_progress: { icon: CircleDot, className: 'text-status-progress' },
  waiting: { icon: Hourglass, className: 'text-warn' },
  blocked: { icon: Ban, className: 'text-status-blocked' },
  deferred: { icon: CirclePause, className: 'text-faint' },
  closed: { icon: CircleCheck, className: 'text-status-closed' },
}

function TreeNode({
  bead,
  depth,
  childrenMap,
  fullMap,
  expanded,
  forceOpen,
  matched,
  now,
  onToggle,
  onOpen,
}: {
  bead: Bead
  depth: number
  childrenMap: Map<string, Bead[]>
  /** Unfiltered tree, so progress counts hidden closed beads too. */
  fullMap: Map<string, Bead[]>
  expanded: Set<string>
  /** A filter is active: every shown node is a match or on a match's path. */
  forceOpen: boolean
  /** Ids matching the filter; undefined without a filter. Others are path-only. */
  matched?: Set<string>
  now: number
  onToggle: (id: string) => void
  onOpen: (bead: Bead) => void
}) {
  const children = useMemo(
    () => [...(childrenMap.get(bead.id) ?? [])].sort(compareHierarchy),
    [childrenMap, bead.id],
  )
  const hasChildren = children.length > 0
  const open = forceOpen || expanded.has(bead.id)
  const priority = Math.max(0, Math.min(4, bead.priority))
  const epic = isEpic(bead)
  const state = rowState(bead)
  const Glyph = STATE_GLYPH[state]
  const muted = state === 'closed' || state === 'deferred'
  const pathOnly = matched !== undefined && !matched.has(bead.id)
  const { latestComment } = useSince()
  // Comments do not bump updated_at, so the row's age follows the newest of the two.
  const touchedAt = Math.max(
    Date.parse(bead.updated_at ?? bead.created_at ?? '') || 0,
    latestComment.get(bead.id) ?? 0,
  )
  const age = touchedAt ? formatSpan(now - touchedAt) : ''
  const waiting = bead.waiting_on ?? []
  const who = initials(bead.assignee)
  const noTasks = epic && (fullMap.get(bead.id)?.length ?? 0) === 0

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2 rounded-[7px] py-1.5 pr-2 transition-colors hover:bg-card-hover',
          bead.status === 'in_progress' &&
            'shadow-[inset_2px_0_0_var(--status-progress)]',
          (muted || pathOnly) && 'opacity-60',
        )}
        style={{ paddingLeft: 6 + depth * 18 }}
      >
        {hasChildren ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onToggle(bead.id)}
            aria-expanded={open}
            aria-label={open ? 'Collapse' : 'Expand'}
            className="shrink-0 text-muted-foreground"
          >
            {open ? (
              <ChevronDown className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden="true" />
            )}
          </Button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden="true" />
        )}

        <InteractiveRow
          variant="plain"
          size="flush"
          data-bead-id={bead.id}
          onClick={() => onOpen(bead)}
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <Glyph.icon
            className={cn('size-3.5 shrink-0', Glyph.className)}
            aria-label={ROW_STATE_LABEL[state]}
          />
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {bead.id}
          </span>
          <ChangedDot id={bead.id} />
          <span
            className={cn(
              'shrink-0 rounded-[4px] px-1 py-px font-mono text-[10px] font-semibold tabular-nums ring-1 ring-inset ring-current',
              PRIORITY_TEXT_CLASS[priority],
            )}
          >
            P{priority}
          </span>
          {epic ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-[4px] bg-primary/30 px-1.5 py-px text-[10px] font-semibold tracking-[0.06em] text-primary-text uppercase ring-1 ring-inset ring-ring/45">
              <Layers className="size-2.5" aria-hidden="true" />
              Epic
            </span>
          ) : null}
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[12.75px]',
              state === 'closed'
                ? 'text-faint line-through decoration-foreground/25'
                : muted
                  ? 'text-muted-foreground'
                  : 'text-foreground',
            )}
          >
            {bead.title}
          </span>
          {noTasks ? (
            <span className="shrink-0 rounded-[4px] border border-dashed border-border-strong px-1.5 py-px text-[10px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
              no tasks yet
            </span>
          ) : null}
          {epic && !noTasks ? (
            <EpicProgress
              stats={descendantStats(bead.id, fullMap)}
              complete={isCompleteEpic(bead, fullMap)}
              took={epicTook(bead, fullMap)}
            />
          ) : hasChildren ? (
            <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-faint">
              {children.length}
            </span>
          ) : null}

          {/* Fixed-width columns, so the eye can run down one of them. */}
          <span className="flex shrink-0 items-center gap-2 font-mono text-[10.5px] text-muted-foreground tabular-nums">
            <span
              className={cn(
                'hidden w-20 truncate text-right md:inline',
                state === 'waiting' && 'text-warn',
              )}
              title={
                state === 'waiting'
                  ? `Waits on ${waiting.join(', ')}`
                  : undefined
              }
            >
              {state === 'waiting'
                ? `waits ${shortId(waiting[0])}${waiting.length > 1 ? ` +${waiting.length - 1}` : ''}`
                : ROW_STATE_LABEL[state]}
            </span>
            <span
              className="hidden w-7 items-center justify-end gap-0.5 lg:inline-flex"
              title={
                bead.comment_count
                  ? `${bead.comment_count} comments`
                  : undefined
              }
            >
              {bead.comment_count ? (
                <>
                  <MessageSquare className="size-2.5" aria-hidden="true" />
                  {bead.comment_count}
                </>
              ) : null}
            </span>
            <span
              className="hidden w-5 justify-center lg:inline-flex"
              title={bead.assignee}
            >
              {who ? (
                <span className="grid size-[18px] place-items-center rounded-full bg-muted text-[8.5px] font-semibold text-foreground ring-1 ring-inset ring-border-strong">
                  {who}
                </span>
              ) : null}
            </span>
            <span
              className="w-8 text-right"
              title={
                touchedAt
                  ? `Latest activity ${new Date(touchedAt).toISOString()}`
                  : undefined
              }
            >
              {age}
            </span>
          </span>
        </InteractiveRow>
      </div>

      {hasChildren && open ? (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.id}
              bead={child}
              depth={depth + 1}
              childrenMap={childrenMap}
              fullMap={fullMap}
              expanded={expanded}
              forceOpen={forceOpen}
              matched={matched}
              now={now}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function HierarchyView({
  project,
  beads,
  closedWindow,
  now,
  matches,
  onShowAllClosed,
  onSetClosedWindow,
  onClearFilters,
  onOpen,
}: HierarchyViewProps) {
  const fullMap = useMemo(() => buildChildrenMap(beads), [beads])
  const { windowed, hiddenCount } = useMemo(() => {
    const hidden = new Set(
      beads
        .filter((b) => isHiddenByWindow(b, fullMap, closedWindow, now))
        .map((b) => b.id),
    )
    return {
      windowed: beads.filter((b) => !hidden.has(b.id)),
      hiddenCount: hidden.size,
    }
  }, [beads, fullMap, closedWindow, now])
  const filtered = useMemo(
    () => (matches ? filterWithAncestors(windowed, matches) : null),
    [windowed, matches],
  )
  const visible = filtered ? filtered.visible : windowed
  const childrenMap = useMemo(() => buildChildrenMap(visible), [visible])
  const roots = useMemo(
    () => [...getRootBeads(visible)].sort(compareHierarchy),
    [visible],
  )

  // Starts collapsed; the choice survives refresh, per project.
  const [expanded, setExpanded] = useState(() => readExpanded(project))
  useEffect(() => writeExpanded(project, expanded), [project, expanded])
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pt-1 pb-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-1.5">
        {filtered ? (
          <span className="text-xs text-muted-foreground" role="status">
            {filtered.matched.size}{' '}
            {filtered.matched.size === 1 ? 'match' : 'matches'}
            {filtered.epics > 0
              ? ` in ${filtered.epics} ${filtered.epics === 1 ? 'epic' : 'epics'}`
              : ''}
          </span>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setExpanded(expandableIds(childrenMap))}
            >
              <ChevronsUpDown aria-hidden="true" />
              Expand all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setExpanded(new Set())}
            >
              <ChevronsDownUp aria-hidden="true" />
              Collapse all
            </Button>
          </>
        )}
        <ClosedHiddenNote
          hidden={hiddenCount}
          onShowAll={onShowAllClosed}
          before={windowCutoff(closedWindow, now)}
        />
      </div>
      {roots.length === 0 ? (
        <EmptyBoard
          beads={beads}
          matches={matches}
          closedWindow={closedWindow}
          now={now}
          onSetClosedWindow={onSetClosedWindow}
          onClearFilters={onClearFilters}
        />
      ) : (
        <div className="flex flex-col gap-0.5">
          {roots.map((root) => (
            <TreeNode
              key={root.id}
              bead={root}
              depth={0}
              childrenMap={childrenMap}
              fullMap={fullMap}
              expanded={expanded}
              forceOpen={filtered !== null}
              matched={filtered?.matched}
              now={now}
              onToggle={toggle}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  )
}
