import { useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { enUS } from 'date-fns/locale'
import {
  AlertTriangle,
  BookOpen,
  Filter,
  MessageSquare,
  Search,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BeadLinkButton } from '@/components/bead-link'
import { InteractiveRow } from '@/components/ui/interactive-row'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useKnowledge } from '@/hooks/use-snapshot'
import {
  KNOWLEDGE_TYPE_DOT_CLASS,
  KNOWLEDGE_TYPE_HINT,
  KNOWLEDGE_TYPE_LABEL,
  KNOWLEDGE_TYPE_PREFIX,
  KNOWLEDGE_TYPES,
} from '@/lib/knowledge'
import { cn } from '@/lib/utils'

import type {
  Bead,
  KnowledgeType,
  ProjectComment,
  ProjectKnowledgeEntry,
} from '@/lib/types'
import type { LucideIcon } from 'lucide-react'

type TypeFilter = KnowledgeType | 'all'

interface ProjectKnowledgePanelProps {
  project: string
  beadsById: Map<string, Bead>
  onOpenKnowledge: (id: string) => void
}

const TYPE_BADGE: Record<KnowledgeType, string> = {
  learned: 'bg-k-learned/15 text-k-learned ring-1 ring-inset ring-k-learned/38',
  decision:
    'bg-k-decision/15 text-k-decision ring-1 ring-inset ring-k-decision/38',
  fact: 'bg-k-fact/15 text-k-fact ring-1 ring-inset ring-k-fact/38',
  pattern: 'bg-k-pattern/15 text-k-pattern ring-1 ring-inset ring-k-pattern/38',
  investigation:
    'bg-k-investigation/15 text-k-investigation ring-1 ring-inset ring-k-investigation/38',
  'must-check':
    'bg-k-must-check/15 text-k-must-check ring-1 ring-inset ring-k-must-check/38',
  deviation:
    'bg-k-deviation/15 text-k-deviation ring-1 ring-inset ring-k-deviation/38',
}

function relativeDate(value?: string): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return formatDistanceToNow(parsed, { addSuffix: true, locale: enUS })
}

function matchesText(
  value: ProjectKnowledgeEntry | ProjectComment,
  query: string,
): boolean {
  if (!query) return true
  const haystack = [
    value.text,
    value.bead_id,
    value.bead_title,
    value.author,
    'content' in value ? value.content : undefined,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(query.toLowerCase())
}

function TypeBadge({ type }: { type: KnowledgeType }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'border-transparent font-mono text-[10px] tracking-[0.08em] uppercase',
        TYPE_BADGE[type],
      )}
    >
      {KNOWLEDGE_TYPE_LABEL[type]}
    </Badge>
  )
}

function OpenBeadButton({ bead, beadId }: { bead?: Bead; beadId: string }) {
  return (
    <BeadLinkButton
      variant="ghost"
      size="sm"
      className="h-6 px-1.5 font-mono text-[0.7rem] text-muted-foreground hover:text-foreground"
      beadId={bead?.id}
    >
      {beadId}
    </BeadLinkButton>
  )
}

export function ProjectKnowledgePanel({
  project,
  beadsById,
  onOpenKnowledge,
}: ProjectKnowledgePanelProps) {
  const [search, setSearch] = useState('')
  const [type, setType] = useState<TypeFilter>('all')

  const query = useKnowledge(project)

  const knowledge = query.data?.knowledge ?? []
  const comments = query.data?.comments ?? []
  const normalizedSearch = search.trim()

  const filteredKnowledge = useMemo(
    () =>
      knowledge.filter(
        (entry) =>
          (type === 'all' || entry.type === type) &&
          matchesText(entry, normalizedSearch),
      ),
    [knowledge, normalizedSearch, type],
  )

  const filteredComments = useMemo(
    () => comments.filter((comment) => matchesText(comment, normalizedSearch)),
    [comments, normalizedSearch],
  )

  const typeCounts = useMemo(() => {
    const counts = new Map<KnowledgeType, number>()
    for (const entry of knowledge) {
      counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1)
    }
    return counts
  }, [knowledge])

  if (query.isLoading) {
    return <KnowledgeSkeleton />
  }

  if (query.isError) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-8 text-center">
        <div className="flex max-w-sm flex-col items-center gap-3">
          <AlertTriangle
            className="size-5 text-destructive"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">
            {query.error instanceof Error
              ? query.error.message
              : 'Failed to load knowledge'}
          </p>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  // Nothing recorded yet (and no filter hiding it): teach the convention in one compact card
  // and give the whole width to the comments instead of a half-screen empty panel.
  const noKnowledgeYet =
    knowledge.length === 0 && !normalizedSearch && type === 'all'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-[8px] bg-canvas px-3 py-2 ring-1 ring-inset ring-border">
        <div className="relative min-w-56 flex-1 sm:max-w-md">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search knowledge and comments..."
            className="h-8 pl-8"
            aria-label="Search knowledge and comments"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="size-3.5 text-muted-foreground" />
          <Select
            value={type}
            onValueChange={(value) => setType(value as TypeFilter)}
          >
            <SelectTrigger size="sm" className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {KNOWLEDGE_TYPES.map((item) => (
                <SelectItem key={item} value={item}>
                  {KNOWLEDGE_TYPE_LABEL[item]}
                  {typeCounts.get(item) ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      {typeCounts.get(item)}
                    </span>
                  ) : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {noKnowledgeYet ? <KnowledgeHowTo /> : null}

      <div
        className={cn(
          'grid min-h-0 flex-1 grid-cols-1 gap-3',
          !noKnowledgeYet &&
            'xl:grid-cols-[minmax(0,1.18fr)_minmax(22rem,0.82fr)]',
        )}
      >
        {noKnowledgeYet ? null : (
          <section className="flex min-h-0 flex-col rounded-[10px] bg-canvas ring-1 ring-inset ring-border">
            <PanelHeader
              icon={BookOpen}
              title="Knowledge"
              count={filteredKnowledge.length}
            />
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {filteredKnowledge.length === 0 ? (
                <EmptyState text="No structured comments." />
              ) : (
                <ul className="flex flex-col gap-2">
                  {filteredKnowledge.map((entry) => {
                    const bead = beadsById.get(entry.bead_id)
                    return (
                      <li
                        key={entry.id}
                        className="flex gap-[11px] rounded-[9px] bg-card ring-1 ring-inset ring-border transition-colors hover:bg-card-hover"
                      >
                        <span
                          className={cn(
                            'w-0.5 shrink-0 self-stretch rounded-full',
                            KNOWLEDGE_TYPE_DOT_CLASS[entry.type],
                          )}
                          aria-hidden="true"
                        />
                        <div className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2.5">
                          <InteractiveRow
                            variant="plain"
                            size="flush"
                            onClick={() => onOpenKnowledge(entry.id)}
                            className="min-w-0 flex-1 rounded-[6px]"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <TypeBadge type={entry.type} />
                              {entry.created_at ? (
                                <span className="text-[11.25px] text-faint">
                                  {relativeDate(entry.created_at)}
                                </span>
                              ) : null}
                            </div>

                            <p className="mt-1.5 text-[12.75px] leading-[1.58] whitespace-pre-wrap text-foreground">
                              {entry.content}
                            </p>

                            {entry.bead_title ? (
                              <p className="mt-1.5 truncate text-[11.25px] text-faint">
                                {entry.bead_title}
                              </p>
                            ) : null}
                          </InteractiveRow>
                          <OpenBeadButton bead={bead} beadId={entry.bead_id} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>
        )}

        <section className="flex min-h-0 flex-col rounded-[10px] bg-canvas ring-1 ring-inset ring-border">
          <PanelHeader
            icon={MessageSquare}
            title="Comments"
            count={filteredComments.length}
          />
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {filteredComments.length === 0 ? (
              <EmptyState text="No comments." />
            ) : (
              <ul className="flex flex-col gap-2">
                {filteredComments.map((comment) => {
                  const bead = beadsById.get(comment.bead_id)
                  return (
                    <li
                      key={comment.id}
                      className="rounded-[9px] bg-canvas px-3 py-2.5 ring-1 ring-inset ring-border"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-faint">
                        {comment.knowledge_type ? (
                          <TypeBadge type={comment.knowledge_type} />
                        ) : null}
                        <OpenBeadButton bead={bead} beadId={comment.bead_id} />
                        {comment.author ? <span>{comment.author}</span> : null}
                        {comment.created_at ? (
                          <span>· {relativeDate(comment.created_at)}</span>
                        ) : null}
                      </div>
                      {comment.bead_title ? (
                        <p className="mt-1 truncate text-[11.25px] text-faint">
                          {comment.bead_title}
                        </p>
                      ) : null}
                      <p className="mt-1.5 text-[13px] whitespace-pre-wrap">
                        {comment.text}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function PanelHeader({
  icon: Icon,
  title,
  count,
}: {
  icon: LucideIcon
  title: string
  count: number
}) {
  return (
    <header className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-muted-foreground">
      <Icon className="size-3.5" aria-hidden="true" />
      <h2 className="font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
        {title}
      </h2>
      <span className="ml-auto font-mono text-[11px] tabular-nums text-faint">
        {count}
      </span>
    </header>
  )
}

/** What a knowledge comment is and how an agent writes one. */
function KnowledgeHowTo() {
  return (
    <section
      className="rounded-[10px] bg-canvas p-3.5 ring-1 ring-inset ring-border"
      aria-label="How to record knowledge"
    >
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <BookOpen className="size-3.5" aria-hidden="true" />
        <h2 className="font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
          No knowledge recorded yet
        </h2>
      </div>
      <p className="mt-2 text-[13px] text-foreground">
        A knowledge entry is an ordinary bead comment that starts with one of
        seven prefixes. Agents write one as they work, and it shows up here:
      </p>
      <pre className="mt-2 max-w-full overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-[12px] text-foreground">
        bd comments add &lt;bead-id&gt; &quot;DECISION: use the events journal,
        not polling&quot;
      </pre>
      <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(17rem,100%),1fr))] gap-x-4 gap-y-1.5">
        {KNOWLEDGE_TYPES.map((t) => (
          <li key={t} className="flex min-w-0 items-start gap-2 text-[12px]">
            <span
              className={cn(
                'mt-1.5 size-1.5 shrink-0 rounded-full',
                KNOWLEDGE_TYPE_DOT_CLASS[t],
              )}
              aria-hidden="true"
            />
            <span className="min-w-0">
              <code className="font-mono font-medium text-foreground">
                {KNOWLEDGE_TYPE_PREFIX[t]}:
              </code>{' '}
              <span className="text-muted-foreground">
                {KNOWLEDGE_TYPE_HINT[t]}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-28 items-center justify-center rounded-md border border-dashed border-border/70 text-sm text-muted-foreground">
      {text}
    </div>
  )
}

function KnowledgeSkeleton() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-2">
      {[0, 1].map((index) => (
        <div
          key={index}
          className="flex min-h-0 flex-col rounded-[10px] bg-canvas ring-1 ring-inset ring-border p-3"
        >
          <Skeleton className="h-5 w-32" />
          <div className="mt-4 flex flex-col gap-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}
