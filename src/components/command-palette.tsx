import {
  Fragment,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { toast } from 'sonner'
import {
  useNavigate,
  useParams,
  useRouter,
  useSearch,
} from '@tanstack/react-router'
import {
  Ban,
  BookOpen,
  Bug,
  CircleCheck,
  CircleDot,
  Columns3,
  FolderOpen,
  History,
  Layers,
  ListTree,
  Search,
  Sparkles,
  User,
  Wrench,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { usePaletteData } from '@/hooks/use-palette-data'
import { formatAge } from '@/lib/age'
import { readLastSeen } from '@/lib/activity'
import { getStoredIdentity } from '@/lib/identity'
import { isDesktopApp } from '@/lib/server'
import {
  buildQuery,
  chipLabel,
  commitChips,
  isEmptyQuery,
  ALL_SCOPE,
  scopeCycle,
} from '@/lib/palette-query'
import { loadRecent, recordRecent } from '@/lib/palette-recent'
import { docKey, searchDocs } from '@/lib/palette-search'
import { beadColumn } from '@/lib/types'
import { cn } from '@/lib/utils'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Chip } from '@/lib/palette-query'
import type { RecentEntry } from '@/lib/palette-recent'
import type { PaletteDoc, PaletteHit, Range } from '@/lib/palette-search'
import type { BeadColumn } from '@/lib/types'

const STATUS_DOT: Record<BeadColumn, string> = {
  open: 'bg-status-open',
  in_progress: 'bg-status-progress',
  blocked: 'bg-status-blocked',
  closed: 'bg-status-closed',
}

const TYPE_ICON: Record<string, LucideIcon> = {
  epic: Layers,
  bug: Bug,
  feature: Sparkles,
  chore: Wrench,
}

const SCOPE_KEY = 'bd-board.palette-scope'
// Last scope chosen this browser session ('all' or a project id); none means "this project".
const readScope = (): string | null => {
  try {
    return sessionStorage.getItem(SCOPE_KEY)
  } catch {
    return null
  }
}
const storeScope = (scope: string) => {
  try {
    sessionStorage.setItem(SCOPE_KEY, scope)
  } catch {
    // private mode: the choice just lasts until the palette closes
  }
}

const modKey = () =>
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
    ? '⌘'
    : 'Ctrl+'

function Highlighted({ text, ranges }: { text: string; ranges: Range[] }) {
  if (!ranges.length) return <>{text}</>
  const parts: React.ReactNode[] = []
  let at = 0
  for (const r of ranges) {
    if (r.start > at) parts.push(text.slice(at, r.start))
    parts.push(
      <mark
        key={r.start}
        className="rounded-[2px] bg-primary/20 px-px text-inherit"
      >
        {text.slice(r.start, r.end)}
      </mark>,
    )
    at = r.end
  }
  if (at < text.length) parts.push(text.slice(at))
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </>
  )
}

interface Row {
  value: string
  /** Set on bead rows: Cmd+C copies it. */
  beadId?: string
  run: (newTab: boolean) => void
  content: ReactNode
}

interface Section {
  heading: string
  rows: Row[]
}

function BeadRow({
  doc,
  hit,
  now,
}: {
  doc: PaletteDoc
  hit?: PaletteHit
  now: number
}) {
  const { bead } = doc
  const column = beadColumn(bead)
  const TypeIcon = TYPE_ICON[bead.issue_type] ?? CircleDot
  const updated = formatAge(bead.updated_at ?? bead.created_at, now)
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[column])}
          aria-hidden="true"
        />
        <TypeIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span
          className={cn(
            'min-w-0 truncate',
            doc.closed ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          <Highlighted text={bead.title} ranges={hit?.titleRanges ?? []} />
        </span>
        <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
          <Highlighted text={bead.id} ranges={hit?.idRanges ?? []} />
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 pl-[1.375rem] text-xs text-muted-foreground">
        <span className="sr-only">
          {column.replace('_', ' ')} {bead.issue_type}
        </span>
        <span className="shrink-0">{doc.projectName}</span>
        {doc.epicTitle ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 truncate">in {doc.epicTitle}</span>
          </>
        ) : null}
        {updated ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">updated {updated}</span>
          </>
        ) : null}
      </div>
      {hit?.snippet ? (
        <div className="truncate pl-[1.375rem] text-xs text-muted-foreground">
          <span className="mr-1 text-faint">{hit.snippet.kind}:</span>
          <Highlighted text={hit.snippet.text} ranges={hit.snippet.ranges} />
        </div>
      ) : null}
    </div>
  )
}

/**
 * Cmd/Ctrl+K search over every bead already loaded, across projects. The ranking is pure
 * (`lib/palette-*`); this is the overlay, chips, keys and live region around it.
 */
export function CommandPalette() {
  const navigate = useNavigate()
  const router = useRouter()
  const current = useParams({ strict: false }).project
  const openBeadId = useSearch({ strict: false }).bead

  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [chips, setChips] = useState<Chip[]>([])
  const [selected, setSelected] = useState('')
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const [copied, setCopied] = useState('')
  const [scope, setScope] = useState<string>(ALL_SCOPE)
  const [switcher, setSwitcher] = useState(false)
  const [switcherAt, setSwitcherAt] = useState(0)
  const [scopeNote, setScopeNote] = useState('')
  const previousFocus = useRef<HTMLElement | null>(null)
  const chose = useRef(false)

  const { projects, docs, comments, loading, indexing } = usePaletteData(
    open,
    current,
  )
  const deferredInput = useDeferredValue(input)
  const query = useMemo(
    () => buildQuery(chips, deferredInput),
    [chips, deferredInput],
  )
  // Who "mine" is and when "since" starts: read once per opening, never while typing.
  const ctx = useMemo(() => {
    if (!open) return {}
    const at = current ? readLastSeen(current) : null
    return {
      me: getStoredIdentity() ?? undefined,
      since: current && at ? { project: current, at } : undefined,
    }
  }, [open, current])
  const hits = useMemo(
    () =>
      searchDocs(docs, query, {
        comments,
        ...ctx,
        scope: scope === ALL_SCOPE ? undefined : scope,
      }),
    [docs, query, comments, ctx, scope],
  )
  const docsByKey = useMemo(() => new Map(docs.map((d) => [d.key, d])), [docs])
  const now = useMemo(() => Date.now(), [docs, open])
  const empty = isEmptyQuery(query)

  // Every way of opening a bead (board, palette, deep link) lands in Recent.
  useEffect(() => {
    if (current && openBeadId)
      recordRecent({ project: current, id: openBeadId })
  }, [current, openBeadId])

  useEffect(() => {
    function onShortcut(e: KeyboardEvent) {
      if (
        e.key.toLowerCase() !== 'k' ||
        !(e.metaKey || e.ctrlKey) ||
        e.altKey ||
        e.shiftKey
      )
        return
      e.preventDefault()
      if (open) {
        setOpen(false)
        return
      }
      previousFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      chose.current = false
      setInput('')
      setChips([])
      setCopied('')
      setScope(readScope() ?? current ?? ALL_SCOPE)
      setSwitcher(false)
      setScopeNote('')
      setRecent(loadRecent())
      setOpen(true)
    }
    document.addEventListener('keydown', onShortcut, true)
    return () => document.removeEventListener('keydown', onShortcut, true)
  }, [open])

  function beadUrl(project: string, id: string): string | null {
    if (isDesktopApp()) return null
    const { href } = router.buildLocation({
      to: '/p/$project',
      params: { project },
      search: { bead: id },
    })
    return window.location.origin + href
  }

  const nameOf = (id: string) =>
    id === ALL_SCOPE
      ? 'All projects'
      : (projects.find((p) => p.id === id)?.name ?? id)

  function chooseScope(next: string) {
    setScope(next)
    storeScope(next)
    setScopeNote(`Searching ${nameOf(next)}`)
    setSwitcher(false)
  }

  function openSwitcher() {
    const options = [ALL_SCOPE, ...projects.map((p) => p.id)]
    setSwitcherAt(Math.max(0, options.indexOf(scope)))
    setSwitcher(true)
  }

  function finish() {
    chose.current = true
    setOpen(false)
  }

  function openBead(project: string, id: string, newTab: boolean) {
    const url = newTab ? beadUrl(project, id) : null
    if (url) {
      window.open(url, '_blank', 'noopener')
    } else if (project === current) {
      void navigate({
        to: '/p/$project',
        params: { project },
        search: (prev) => ({ ...prev, bead: id, k: undefined }),
      })
    } else {
      void navigate({
        to: '/p/$project',
        params: { project },
        search: { bead: id },
      })
    }
    finish()
  }

  function addChips(next: Chip[]) {
    setChips((prev) => [
      ...prev,
      ...next.filter(
        (c) => !prev.some((p) => p.kind === c.kind && p.value === c.value),
      ),
    ])
  }

  const beadRow = (doc: PaletteDoc, prefix: string, hit?: PaletteHit): Row => ({
    value: `${prefix}${doc.key}`,
    beadId: doc.bead.id,
    run: (newTab) => openBead(doc.project, doc.bead.id, newTab),
    content: <BeadRow doc={doc} hit={hit} now={now} />,
  })

  const filterRow = (
    value: string,
    label: string,
    Icon: LucideIcon,
    chip: Chip,
  ): Row => ({
    value: `jump:${value}`,
    run: () => {
      addChips([chip])
      setInput('')
    },
    content: (
      <>
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        {label}
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {chipLabel(chip)}
        </span>
      </>
    ),
  })

  const projectRow = (id: string, name: string): Row => ({
    value: `jump:project:${id}`,
    run: (newTab) => {
      const { href } = router.buildLocation({
        to: '/p/$project',
        params: { project: id },
      })
      if (newTab && !isDesktopApp())
        window.open(window.location.origin + href, '_blank', 'noopener')
      else void navigate({ to: '/p/$project', params: { project: id } })
      finish()
    },
    content: (
      <>
        <FolderOpen
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        Open project {name}
        {id === current && (
          <span className="ml-auto text-xs text-muted-foreground">current</span>
        )}
      </>
    ),
  })

  const goRow = (
    value: string,
    label: string,
    Icon: LucideIcon,
    to: () => void,
  ): Row => ({
    value: `jump:${value}`,
    run: () => {
      to()
      finish()
    },
    content: (
      <>
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        {label}
      </>
    ),
  })

  const sections: Section[] = []
  if (empty) {
    const recentRows = recent
      .map((r) => docsByKey.get(docKey(r.project, r.id)))
      .filter((d): d is PaletteDoc => Boolean(d))
      .map((d) => beadRow(d, 'recent:'))
    if (recentRows.length)
      sections.push({ heading: 'Recent', rows: recentRows })

    const tab = (t: 'board' | 'hierarchy' | 'knowledge') => () =>
      void navigate({
        to: '/p/$project',
        params: { project: current ?? '' },
        search: { tab: t },
      })
    sections.push({
      heading: 'Jump to',
      rows: [
        filterRow('blocked', 'Blocked', Ban, { kind: 'is', value: 'blocked' }),
        filterRow('ready', 'Ready', CircleCheck, {
          kind: 'is',
          value: 'ready',
        }),
        ...(ctx.since
          ? [
              filterRow('since', 'Since last visit', History, {
                kind: 'is',
                value: 'since',
              }),
            ]
          : []),
        ...(ctx.me
          ? [filterRow('mine', 'Mine', User, { kind: 'is', value: 'mine' })]
          : []),
        ...(current
          ? [
              goRow('board', 'Board', Columns3, tab('board')),
              goRow('hierarchy', 'Hierarchy', ListTree, tab('hierarchy')),
            ]
          : []),
        ...projects.map((p) => projectRow(p.id, p.name)),
        goRow(
          'projects',
          'Projects',
          FolderOpen,
          () => void navigate({ to: '/' }),
        ),
        ...(current
          ? [goRow('knowledge', 'Knowledge', BookOpen, tab('knowledge'))]
          : []),
      ],
    })
  } else {
    const main = hits
      .filter((h) => !h.late)
      .map((h) => beadRow(h.doc, 'hit:', h))
    const late = hits
      .filter((h) => h.late)
      .map((h) => beadRow(h.doc, 'late:', h))
    if (main.length) sections.push({ heading: 'Beads', rows: main })
    if (late.length)
      sections.push({ heading: 'In comments and artifacts', rows: late })
  }

  const rows = sections.flatMap((sec) => sec.rows)
  const rowByValue = new Map(rows.map((r) => [r.value, r]))
  const firstValue = rows[0]?.value ?? ''
  useEffect(() => {
    if (open) setSelected(firstValue)
  }, [open, firstValue])

  function onInput(value: string) {
    const { chips: done, rest } = commitChips(value)
    if (done.length) addChips(done)
    setInput(rest)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey
    if (switcher) {
      const options = [ALL_SCOPE, ...projects.map((p) => p.id)]
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setSwitcherAt((i) => (i + step + options.length) % options.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const id = options[switcherAt]
        chooseScope(id)
        // Cmd/Ctrl+Enter also goes there.
        if (mod && id !== ALL_SCOPE) {
          void navigate({ to: '/p/$project', params: { project: id } })
          finish()
        }
      } else if (e.key === 'Tab') {
        setSwitcher(false)
      }
      return
    }
    if (mod && e.shiftKey && !e.altKey && e.code === 'Period') {
      e.preventDefault()
      chooseScope(
        scopeCycle(
          scope,
          current,
          projects.map((p) => p.id),
        ),
      )
    } else if (mod && e.shiftKey && !e.altKey && e.code === 'KeyL') {
      e.preventDefault()
      openSwitcher()
    } else if (e.key === 'Enter' && mod) {
      e.preventDefault()
      rowByValue.get(selected)?.run(true)
    } else if (e.key === 'Backspace' && input === '' && chips.length) {
      e.preventDefault()
      setChips((prev) => prev.slice(0, -1))
    } else if (e.key.toLowerCase() === 'c' && mod && !e.shiftKey) {
      // Cmd+C on a row copies its id; text selected in the input keeps its normal copy.
      const field = e.target as HTMLInputElement
      const id = rowByValue.get(selected)?.beadId
      if (id && field.selectionStart === field.selectionEnd) {
        e.preventDefault()
        navigator.clipboard.writeText(id).then(
          () => {
            setCopied(`Copied ${id}`)
            toast.success(`Copied ${id}`)
          },
          () => toast.error('Could not copy'),
        )
      }
    }
  }

  const scopeLabel = nameOf(scope)
  const scoped = scope !== ALL_SCOPE
  const countText = [
    copied ||
      (empty
        ? ''
        : hits.length === 0
          ? 'No matching beads'
          : `${hits.length} ${hits.length === 1 ? 'result' : 'results'}`),
    scopeNote,
  ]
    .filter(Boolean)
    .join('. ')
  const mod = modKey()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        data-slot="command-palette"
        showCloseButton={false}
        onEscapeKeyDown={(e) => {
          if (switcher) {
            e.preventDefault()
            setSwitcher(false)
          }
        }}
        className="top-[15vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onCloseAutoFocus={(e) => {
          // Radix only refocuses a trigger; this dialog has none, so restore by hand
          // (unless a bead was chosen: its own modal owns focus then).
          e.preventDefault()
          if (!chose.current && previousFocus.current?.isConnected)
            previousFocus.current.focus()
        }}
      >
        <DialogTitle className="sr-only">Search beads</DialogTitle>
        <DialogDescription className="sr-only">
          Search every project by id, title, description, labels, assignee,
          comments and artifact paths. Narrow with status:, type:, label:,
          epic:, project:, is:mine and @name filters.
        </DialogDescription>
        <CommandPrimitive
          shouldFilter={false}
          loop
          value={selected}
          onValueChange={setSelected}
          onKeyDown={onKeyDown}
          label="Search beads"
          className="flex min-w-0 flex-col"
        >
          <div className="relative flex items-center gap-2 border-b border-border px-3 py-2">
            <Search
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {chips.map((chip, i) => (
                <Button
                  key={`${chip.kind}:${chip.value}`}
                  type="button"
                  variant="secondary"
                  size="xs"
                  tabIndex={-1}
                  aria-label={`Remove filter ${chipLabel(chip)}`}
                  onClick={() =>
                    setChips((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="font-mono"
                >
                  {chipLabel(chip)}
                  <X aria-hidden="true" />
                </Button>
              ))}
              <Button
                type="button"
                variant="outline"
                size="xs"
                tabIndex={-1}
                data-testid="palette-scope"
                aria-label={`Search scope: ${scopeLabel}. Press ${mod}Shift+L to pick a project, ${mod}Shift+. for the next`}
                aria-haspopup="listbox"
                aria-expanded={switcher}
                onClick={() => (switcher ? setSwitcher(false) : openSwitcher())}
                className="max-w-40 shrink-0 truncate disabled:opacity-100"
              >
                {scopeLabel}
              </Button>
              {switcher && (
                <ul
                  role="listbox"
                  aria-label="Search scope"
                  className="absolute top-11 left-9 z-10 max-h-60 w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm shadow-md"
                >
                  {[ALL_SCOPE, ...projects.map((p) => p.id)].map((id, i) => (
                    <li
                      key={id}
                      role="option"
                      aria-selected={id === scope}
                      data-active={i === switcherAt}
                      onMouseEnter={() => setSwitcherAt(i)}
                      onClick={(e) => {
                        chooseScope(id)
                        if ((e.metaKey || e.ctrlKey) && id !== ALL_SCOPE) {
                          void navigate({
                            to: '/p/$project',
                            params: { project: id },
                          })
                          finish()
                        }
                      }}
                      className="flex cursor-default items-center gap-2 rounded-md px-2 py-1 data-[active=true]:bg-muted"
                    >
                      <span className="truncate">{nameOf(id)}</span>
                      {id === current && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          current
                        </span>
                      )}
                      {id === scope && <span aria-hidden="true">✓</span>}
                    </li>
                  ))}
                </ul>
              )}
              <CommandPrimitive.Input
                autoFocus
                value={input}
                onValueChange={onInput}
                aria-label="Search all beads"
                placeholder={
                  chips.length
                    ? 'Search…'
                    : `Search ${scoped ? scopeLabel : 'all projects'}, or filter: status: type: label: epic: project: @name`
                }
                className="min-w-40 flex-1 bg-transparent py-1 text-sm text-foreground outline-hidden placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <CommandPrimitive.List
            aria-label="Results"
            className="max-h-[min(55vh,26rem)] overflow-x-hidden overflow-y-auto p-1"
          >
            {sections.length ? (
              sections.map((sec) => (
                <CommandPrimitive.Group
                  key={sec.heading}
                  heading={sec.heading}
                  className={GROUP}
                >
                  {sec.rows.map((row) => (
                    <CommandPrimitive.Item
                      key={row.value}
                      value={row.value}
                      onSelect={() => row.run(false)}
                      className="flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-hidden select-none data-selected:bg-muted"
                    >
                      {row.content}
                    </CommandPrimitive.Item>
                  ))}
                </CommandPrimitive.Group>
              ))
            ) : (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {loading ? 'Loading beads…' : 'No beads match.'}
              </p>
            )}
          </CommandPrimitive.List>

          <div className="flex h-9 items-center justify-between gap-3 border-t border-border px-3 text-xs text-muted-foreground">
            <span className="truncate">
              ↑↓ move · ↵ open · {mod}↵ new tab · {mod}C copy id · {mod}⇧L
              project ·{mod}⇧. next scope · Esc close
            </span>
            <span className={cn('shrink-0', !indexing && 'invisible')}>
              indexing comments…
            </span>
          </div>
          <div role="status" aria-live="polite" className="sr-only">
            {countText}
          </div>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  )
}

const GROUP =
  'p-1 **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground'
