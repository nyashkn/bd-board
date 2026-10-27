import {
  ArrowUpDown,
  Columns3,
  Filter,
  Layers,
  ListTree,
  Plus,
  Search,
  SlidersHorizontal,
  Tag,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import {
  PRIORITIES,
  SORT_OPTIONS,
  priorityFilterLabel,
  visibleLabels,
} from '@/lib/sort'
import { CLOSED_WINDOWS } from '@/lib/closed-window'

import type { LucideIcon } from 'lucide-react'
import type { SortKey } from '@/lib/sort'
import type { ClosedWindow } from '@/lib/closed-window'

export type BoardView = 'status' | 'epic' | 'priority'
export type ProjectTab = 'board' | 'knowledge' | 'hierarchy'

interface BoardHeaderProps {
  search: string
  setSearch: (value: string) => void
  view: BoardView
  setView: (value: BoardView) => void
  priorities: number[]
  setPriorities: (value: number[]) => void
  ready: boolean
  setReady: (value: boolean) => void
  assignee: string
  setAssignee: (value: string) => void
  availableLabels: { label: string; count: number }[]
  labels: string[]
  setLabels: (value: string[]) => void
  sort: SortKey
  setSort: (value: SortKey) => void

  nested: boolean
  setNested: (value: boolean) => void
  closedWindow: ClosedWindow
  setClosedWindow: (value: ClosedWindow) => void
  /** Omitted for read-only projects: no "New bead". */
  onCreate?: () => void
  liveIndicator: React.ReactNode
  /** Hierarchy tab: same filters, but no group-by, nesting or sort (the tree has its own order). */
  hierarchy?: boolean
}

const VIEWS: { key: BoardView; label: string; icon: LucideIcon }[] = [
  { key: 'epic', label: 'Epics', icon: Layers },
  { key: 'priority', label: 'Priority', icon: SlidersHorizontal },
  { key: 'status', label: 'Status', icon: Columns3 },
]

const PRIORITY_HINT: Record<number, string> = {
  0: 'highest',
  4: 'lowest',
}

/** Recency window for closed beads and completed epics (URL param `closed`). */
export function ClosedWindowSelect({
  value,
  onChange,
}: {
  value: ClosedWindow
  onChange: (value: ClosedWindow) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Closed</span>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => v && onChange(v as ClosedWindow)}
        aria-label="Show closed beads from the last"
      >
        {CLOSED_WINDOWS.map((w) => (
          <ToggleGroupItem
            key={w}
            value={w}
            aria-label={w === 'all' ? 'All closed' : `Closed in the last ${w}`}
          >
            {w === 'all' ? 'All' : w}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

export function BoardHeader({
  search,
  setSearch,
  view,
  setView,
  priorities,
  setPriorities,
  ready,
  setReady,
  assignee,
  setAssignee,
  availableLabels,
  labels,
  setLabels,
  sort,
  setSort,
  nested,
  setNested,
  closedWindow,
  setClosedWindow,
  onCreate,
  liveIndicator,
  hierarchy = false,
}: BoardHeaderProps) {
  function togglePriority(p: number, checked: boolean) {
    setPriorities(
      checked
        ? [...priorities, p].sort((a, b) => a - b)
        : priorities.filter((x) => x !== p),
    )
  }

  function toggleLabel(label: string) {
    setLabels(
      labels.includes(label)
        ? labels.filter((x) => x !== label)
        : [...labels, label],
    )
  }

  const { shown, hidden } = visibleLabels(availableLabels, labels)

  function renderChip({ label, count }: { label: string; count: number }) {
    const on = labels.includes(label)
    return (
      <Toggle
        key={label}
        pressed={on}
        onPressedChange={() => toggleLabel(label)}
        className={cn(
          'h-6 gap-1 rounded-full px-2 text-xs ring-1 ring-inset',
          on
            ? 'bg-primary/26 text-primary-text ring-ring/55'
            : 'text-muted-foreground ring-border',
        )}
      >
        {label}
        <span className="tabular-nums opacity-60">{count}</span>
      </Toggle>
    )
  }

  return (
    <header className="flex flex-col gap-3 pb-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {hierarchy ? null : (
          <>
            <span className="text-xs text-muted-foreground">Group</span>
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(value) => value && setView(value as BoardView)}
              aria-label="Group by"
            >
              {VIEWS.map((v) => {
                const Icon = v.icon
                return (
                  <ToggleGroupItem
                    key={v.key}
                    value={v.key}
                    aria-label={v.label}
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                    {v.label}
                  </ToggleGroupItem>
                )
              })}
            </ToggleGroup>

            <Toggle
              pressed={nested}
              onPressedChange={setNested}
              aria-label="Nest subtasks inside their parent card"
              className="gap-1.5"
            >
              <ListTree className="size-3.5" aria-hidden="true" />
              Nested
            </Toggle>
          </>
        )}

        <ClosedWindowSelect value={closedWindow} onChange={setClosedWindow} />

        {ready ? (
          <Badge variant="filter" onRemove={() => setReady(false)}>
            Ready
          </Badge>
        ) : null}

        {assignee ? (
          <Badge
            variant="filter"
            className="max-w-48"
            onRemove={() => setAssignee('')}
          >
            <span className="truncate">{assignee}</span>
          </Badge>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {liveIndicator}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                aria-label="Filter by priority"
              >
                <Filter className="size-3.5" aria-hidden="true" />
                {priorities.length > 0
                  ? `Priority: ${priorityFilterLabel(priorities)}`
                  : 'Filter: priority'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>Filter by priority</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {PRIORITIES.map((p) => (
                <DropdownMenuCheckboxItem
                  key={p}
                  checked={priorities.includes(p)}
                  onCheckedChange={(checked) =>
                    togglePriority(p, Boolean(checked))
                  }
                  onSelect={(e) => e.preventDefault()}
                >
                  <span className="font-mono font-medium">P{p}</span>
                  {PRIORITY_HINT[p] ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      · {PRIORITY_HINT[p]}
                    </span>
                  ) : null}
                </DropdownMenuCheckboxItem>
              ))}
              {priorities.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setPriorities([])}>
                    Clear filter
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          {hierarchy ? null : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  aria-label="Sort beads"
                >
                  <ArrowUpDown className="size-3.5" aria-hidden="true" />
                  Sort: {SORT_OPTIONS.find((o) => o.key === sort)?.label}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={(v) => setSort(v as SortKey)}
                >
                  {SORT_OPTIONS.map((o) => (
                    <DropdownMenuRadioItem key={o.key} value={o.key}>
                      {o.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="h-8 w-40 pl-8 sm:w-52"
              aria-label="Search beads"
            />
          </div>

          {onCreate ? (
            <Button size="sm" onClick={onCreate}>
              <Plus aria-hidden="true" />
              New bead
            </Button>
          ) : null}
        </div>
      </div>

      {availableLabels.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter by label (view filter only)"
        >
          <Tag
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          {shown.map(renderChip)}
          {hidden.length > 0 ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 rounded-full px-2 text-xs"
                >
                  +{hidden.length} more
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="flex max-h-72 w-[min(28rem,90vw)] flex-wrap content-start gap-1.5 overflow-y-auto"
              >
                {hidden.map(renderChip)}
              </PopoverContent>
            </Popover>
          ) : null}
          {labels.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setLabels([])}
            >
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}
    </header>
  )
}
