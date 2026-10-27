import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { toast } from 'sonner'

import { BoardHeader } from '@/components/board-header'
import { BoardSwimlanes } from '@/components/board-swimlanes'
import { KanbanColumn } from '@/components/kanban-column'
import { BeadCard } from '@/components/bead-card'
import { BeadDetailModal } from '@/components/bead-detail-modal'
import { HierarchyView } from '@/components/hierarchy-view'
import { KnowledgeDetailModal } from '@/components/knowledge-detail-modal'
import { CreateBeadDialog } from '@/components/create-bead-dialog'
import { ProjectKnowledgePanel } from '@/components/project-knowledge-panel'
import { LiveUpdatesIndicator } from '@/components/live-updates-indicator'
import { ReadonlyContext } from '@/components/readonly-badge'
import { Button } from '@/components/ui/button'
import { SinceBand, SinceContext } from '@/components/since-band'
import {
  getBeads,
  getProjectKnowledgeFn,
  getProjects,
  updateBeadStatusFn,
} from '@/lib/server'
import { diffSince, latestCommentByBead } from '@/lib/activity'
import { COLUMNS, beadColumn, isEpic } from '@/lib/types'
import {
  beadMatches,
  compareBeads,
  labelCounts,
  parseLabelsParam,
  serializeLabels,
} from '@/lib/sort'
import {
  DEFAULT_CLOSED_WINDOW,
  isHiddenByWindow,
  parseClosedWindow,
  readStoredClosedWindow,
  storeClosedWindow,
} from '@/lib/closed-window'
import { buildChildrenMap } from '@/lib/tree'
import { toErrorMessage } from '@/lib/utils'
import { useBeadFeed } from '@/hooks/use-bead-feed'
import { useSinceLastSeen } from '@/hooks/use-since-last-seen'

import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { BoardView, ProjectTab } from '@/components/board-header'
import type { SortKey } from '@/lib/sort'
import type { ClosedWindow } from '@/lib/closed-window'
import type { Bead, BeadColumn } from '@/lib/types'

interface BoardSearch {
  bead?: string
  k?: string
  q?: string
  p?: string
  ready?: string
  assignee?: string
  l?: string
  tab?: ProjectTab
  view?: BoardView
  sort?: SortKey
  nested?: string
  closed?: ClosedWindow
}

const BOARD_VIEWS = new Set(['status', 'epic', 'priority'])
const PROJECT_TABS = new Set(['board', 'knowledge', 'hierarchy'])
const SORT_KEYS = new Set(['priority', 'recent', 'title'])

function parsePriorityParam(value?: string): number[] {
  if (!value) return []
  return Array.from(
    new Set(
      value
        .split(',')
        .map((part) => Number(part))
        .filter(
          (priority) =>
            Number.isInteger(priority) && priority >= 0 && priority <= 4,
        ),
    ),
  ).sort((a, b) => a - b)
}

function serializePriorities(values: number[]): string | undefined {
  return values.length > 0 ? values.join(',') : undefined
}

export const Route = createFileRoute('/p/$project')({
  validateSearch: (search: Record<string, unknown>): BoardSearch => ({
    bead:
      typeof search.bead === 'string' && search.bead.length > 0
        ? search.bead
        : undefined,
    k:
      typeof search.k === 'string' && search.k.length > 0
        ? search.k
        : undefined,
    q: typeof search.q === 'string' && search.q.trim() ? search.q : undefined,
    p:
      typeof search.p === 'string'
        ? serializePriorities(parsePriorityParam(search.p))
        : undefined,
    ready: search.ready === '1' ? '1' : undefined,
    assignee:
      typeof search.assignee === 'string' && search.assignee.length > 0
        ? search.assignee
        : undefined,
    l:
      typeof search.l === 'string'
        ? serializeLabels(parseLabelsParam(search.l))
        : undefined,
    tab:
      typeof search.tab === 'string' && PROJECT_TABS.has(search.tab)
        ? (search.tab as ProjectTab)
        : undefined,
    view:
      typeof search.view === 'string' && BOARD_VIEWS.has(search.view)
        ? (search.view as BoardView)
        : undefined,
    sort:
      typeof search.sort === 'string' && SORT_KEYS.has(search.sort)
        ? (search.sort as SortKey)
        : undefined,
    nested: search.nested === '1' ? '1' : undefined,
    closed: parseClosedWindow(search.closed),
  }),
  component: BoardPage,
})

const COLUMN_LABEL: Record<BeadColumn, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  closed: 'Closed',
}

const COLUMN_KEYS: BeadColumn[] = ['open', 'in_progress', 'blocked', 'closed']

function BoardPage() {
  const { project } = Route.useParams()
  const boardSearch = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [activeBead, setActiveBead] = useState<Bead | null>(null)

  const beadParam = boardSearch.bead
  const knowledgeParam = boardSearch.k
  const search = boardSearch.q ?? ''
  const tab = boardSearch.tab ?? 'board'
  const view = boardSearch.view ?? 'epic'
  const priorities = useMemo(
    () => parsePriorityParam(boardSearch.p),
    [boardSearch.p],
  )
  const ready = boardSearch.ready === '1'
  const assignee = boardSearch.assignee ?? ''
  const labels = useMemo(() => parseLabelsParam(boardSearch.l), [boardSearch.l])

  const sort = boardSearch.sort ?? 'priority'
  const nested = boardSearch.nested === '1'
  const closedWindow = boardSearch.closed ?? DEFAULT_CLOSED_WINDOW
  const urlClosed = boardSearch.closed

  // URL wins; with no `closed` param, restore the last stored choice into the URL.
  useEffect(() => {
    if (urlClosed) return
    const stored = readStoredClosedWindow()
    if (stored && stored !== DEFAULT_CLOSED_WINDOW)
      navigate({
        to: '.',
        replace: true,
        search: (prev) => ({ ...prev, closed: stored }),
      })
  }, [urlClosed, navigate])

  function setClosedWindow(value: ClosedWindow) {
    storeClosedWindow(value)
    patchBoardSearch({ closed: value })
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => getProjects(),
    refetchInterval: 15000,
    staleTime: 5000,
  })
  // Unknown (still loading) counts as read-only so write controls never flash up.
  const readonly = projectsQuery.data
    ? Boolean(projectsQuery.data.find((p) => p.id === project)?.readonly)
    : true

  const feed = useBeadFeed(project, readonly)

  const beadsQuery = useQuery({
    queryKey: ['beads', project],
    queryFn: () => getBeads({ data: { project } }),
    refetchInterval: feed.status === 'live' ? 60_000 : 8_000,
    staleTime: 3000,
    retry: false,
  })

  const beads = beadsQuery.data ?? []

  // Comments are not in `bd list` and do not bump updated_at, so activity needs the same
  // `bd export` read the Knowledge tab uses (one extra call, shared cache key, refreshed at most every 30 s).
  const { since, dismiss: dismissSince } = useSinceLastSeen(project)
  const commentsQuery = useQuery({
    queryKey: ['project-knowledge', project],
    queryFn: () => getProjectKnowledgeFn({ data: { project } }),
    enabled: since !== null,
    staleTime: 30_000,
    retry: false,
  })
  const latestComment = useMemo(
    () => latestCommentByBead(commentsQuery.data?.comments ?? []),
    [commentsQuery.data],
  )
  const change = useMemo(
    () => (since === null ? null : diffSince(beads, since, latestComment)),
    [beads, since, latestComment],
  )
  const sinceValue = useMemo(
    () => ({ changes: change?.byBead ?? new Map(), latestComment }),
    [change, latestComment],
  )

  const beadsById = useMemo(() => {
    const map = new Map<string, Bead>()
    for (const bead of beads) map.set(bead.id, bead)
    return map
  }, [beads])

  const epics = useMemo(() => beads.filter(isEpic), [beads])
  const availableLabels = useMemo(() => labelCounts(beads), [beads])

  const filtered = useMemo(
    () =>
      beads.filter(
        (bead) =>
          beadMatches(bead, search, priorities, ready, assignee, labels) &&
          (!nested || !bead.parent),
      ),
    [beads, search, priorities, ready, assignee, labels, nested],
  )

  // The Board's filters, as one predicate for the Hierarchy tab (null when none is set).
  const hierarchyMatches = useMemo(
    () =>
      search.trim() || priorities.length || ready || assignee || labels.length
        ? (b: Bead) =>
            beadMatches(b, search, priorities, ready, assignee, labels)
        : null,
    [search, priorities, ready, assignee, labels],
  )

  const now = useMemo(() => Date.now(), [beads])
  const childrenMap = useMemo(() => buildChildrenMap(beads), [beads])

  const columns = useMemo(() => {
    const grouped: Record<BeadColumn, Bead[]> = {
      open: [],
      in_progress: [],
      blocked: [],
      closed: [],
    }
    for (const bead of filtered)
      if (!isHiddenByWindow(bead, childrenMap, closedWindow, now))
        grouped[beadColumn(bead)].push(bead)
    const compare = compareBeads(sort)
    for (const key of COLUMN_KEYS) grouped[key].sort(compare)
    return grouped
  }, [filtered, sort, childrenMap, closedWindow, now])
  const closedTotal = useMemo(
    () => filtered.filter((b) => beadColumn(b) === 'closed').length,
    [filtered],
  )

  const selected = beadParam ? (beadsById.get(beadParam) ?? null) : null
  const modalOpen = beadParam !== undefined

  function openBead(bead: Bead) {
    navigate({
      to: '.',
      search: (prev) => ({ ...prev, bead: bead.id, k: undefined }),
    })
  }

  function openKnowledge(id: string) {
    navigate({
      to: '.',
      search: (prev) => ({ ...prev, k: id, bead: undefined }),
    })
  }

  function setKnowledgeOpen(next: boolean) {
    if (!next)
      navigate({ to: '.', search: (prev) => ({ ...prev, k: undefined }) })
  }

  function patchBoardSearch(patch: Partial<BoardSearch>) {
    navigate({
      to: '.',
      replace: true,
      search: (prev) => ({ ...prev, ...patch }),
    })
  }

  function setModalOpen(next: boolean) {
    if (!next)
      navigate({ to: '.', search: (prev) => ({ ...prev, bead: undefined }) })
  }

  async function applyDrop(activeId: string, toColumn: BeadColumn) {
    if (readonly) return
    const previous = queryClient.getQueryData<Bead[]>(['beads', project])
    const bead = (previous ?? beads).find((b) => b.id === activeId)
    if (!bead || beadColumn(bead) === toColumn) return

    queryClient.setQueryData<Bead[]>(['beads', project], (old) =>
      (old ?? []).map((b) =>
        b.id === activeId ? { ...b, status: toColumn } : b,
      ),
    )
    try {
      await updateBeadStatusFn({
        data: { project, id: activeId, status: toColumn },
      })
    } catch (error) {
      queryClient.setQueryData(['beads', project], previous)
      toast.error(
        error instanceof Error ? error.message : 'Failed to move bead',
      )
    } finally {
      queryClient.invalidateQueries({ queryKey: ['beads', project] })
    }
  }

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
    <ReadonlyContext.Provider value={readonly}>
      <SinceContext.Provider value={sinceValue}>
        <div className="flex h-[calc(100dvh-6rem)] min-h-0 flex-col">
          {tab === 'board' || tab === 'hierarchy' ? (
            <BoardHeader
              hierarchy={tab === 'hierarchy'}
              search={search}
              setSearch={(value) =>
                patchBoardSearch({ q: value.trim() ? value : undefined })
              }
              view={view}
              setView={(value) => patchBoardSearch({ view: value })}
              priorities={priorities}
              setPriorities={(values) =>
                patchBoardSearch({ p: serializePriorities(values) })
              }
              ready={ready}
              setReady={(value) =>
                patchBoardSearch({ ready: value ? '1' : undefined })
              }
              assignee={assignee}
              setAssignee={(value) =>
                patchBoardSearch({ assignee: value || undefined })
              }
              availableLabels={availableLabels}
              labels={labels}
              setLabels={(values) =>
                patchBoardSearch({ l: serializeLabels(values) })
              }
              sort={sort}
              setSort={(value) => patchBoardSearch({ sort: value })}
              nested={nested}
              setNested={(value) =>
                patchBoardSearch({ nested: value ? '1' : undefined })
              }
              closedWindow={closedWindow}
              setClosedWindow={setClosedWindow}
              onCreate={readonly ? undefined : () => setCreateOpen(true)}
              liveIndicator={
                <LiveUpdatesIndicator
                  status={feed.status}
                  message={feed.message}
                />
              }
            />
          ) : null}

          {(tab === 'board' || tab === 'hierarchy') &&
          since !== null &&
          change ? (
            <SinceBand
              since={since}
              change={change}
              beadsById={beadsById}
              onOpen={openBead}
              onDismiss={dismissSince}
            />
          ) : null}

          {beadsQuery.isLoading ? (
            <BoardSkeleton />
          ) : beadsQuery.isError ? (
            <BoardError
              message={toErrorMessage(beadsQuery.error, 'Failed to load beads')}
              onRetry={() => beadsQuery.refetch()}
            />
          ) : tab === 'knowledge' ? (
            <ProjectKnowledgePanel
              project={project}
              beadsById={beadsById}
              onOpenBead={openBead}
              onOpenKnowledge={openKnowledge}
              refetchInterval={feed.status === 'live' ? 60_000 : 12_000}
            />
          ) : tab === 'hierarchy' ? (
            <HierarchyView
              key={project}
              project={project}
              beads={beads}
              closedWindow={closedWindow}
              now={now}
              matches={hierarchyMatches}
              onShowAllClosed={() => setClosedWindow('all')}
              onOpen={openBead}
            />
          ) : view === 'epic' || view === 'priority' ? (
            <BoardSwimlanes
              beads={beads}
              search={search}
              priorities={priorities}
              ready={ready}
              assignee={assignee}
              labels={labels}
              sort={sort}
              groupBy={view}
              nested={nested}
              closedWindow={closedWindow}
              now={now}
              onShowAllClosed={() => setClosedWindow('all')}
              onOpen={openBead}
              applyDrop={applyDrop}
            />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={() => setActiveBead(null)}
            >
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 pt-2 pb-1 md:grid-cols-2 xl:grid-cols-4">
                {COLUMNS.map((c) => (
                  <KanbanColumn
                    key={c.key}
                    column={c.key}
                    label={COLUMN_LABEL[c.key]}
                    beads={columns[c.key]}
                    onOpen={openBead}
                    nested={nested}
                    total={c.key === 'closed' ? closedTotal : undefined}
                    onShowAll={() => setClosedWindow('all')}
                  />
                ))}
              </div>
              <DragOverlay>
                {activeBead ? (
                  <BeadCard bead={activeBead} onOpen={() => {}} overlay />
                ) : null}
              </DragOverlay>
            </DndContext>
          )}

          <BeadDetailModal
            project={project}
            bead={selected}
            open={modalOpen}
            onOpenChange={setModalOpen}
            onOpenBead={openBead}
            resolveBead={(id) => beadsById.get(id)}
            onOpenKnowledge={openKnowledge}
          />
          <KnowledgeDetailModal
            project={project}
            knowledgeId={knowledgeParam ?? null}
            open={knowledgeParam !== undefined}
            onOpenChange={setKnowledgeOpen}
            beadsById={beadsById}
            onOpenBead={openBead}
            onOpenKnowledge={openKnowledge}
          />
          {readonly ? null : (
            <CreateBeadDialog
              project={project}
              epics={epics}
              open={createOpen}
              onOpenChange={setCreateOpen}
            />
          )}
        </div>
      </SinceContext.Provider>
    </ReadonlyContext.Provider>
  )
}

function BoardSkeleton() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((c) => (
        <div key={c.key} className="flex h-full min-w-0 flex-col gap-2">
          <div className="h-5 w-24 rounded bg-muted/60" />
          <div className="flex-1 rounded-xl bg-muted/20 ring-1 ring-inset ring-foreground/5" />
        </div>
      ))}
    </div>
  )
}

function BoardError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-8 text-center">
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  )
}
