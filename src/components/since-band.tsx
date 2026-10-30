import { createContext, useContext, useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InteractiveRow } from '@/components/ui/interactive-row'
import { CHANGE_LABEL, changeParts } from '@/lib/activity'
import { cn } from '@/lib/utils'

import type { ChangeKind, ChangeSet } from '@/lib/activity'
import type { Bead } from '@/lib/types'

interface SinceValue {
  changes: Map<string, ChangeKind>
  /** Newest comment time (ms) per bead id. */
  latestComment: Map<string, number>
  /** Bead ids with an unanswered `stopped` question (needs the owner). */
  asking: Set<string>
}

const EMPTY: SinceValue = {
  changes: new Map(),
  latestComment: new Map(),
  asking: new Set(),
}

export const SinceContext = createContext<SinceValue>(EMPTY)

export function useSince(): SinceValue {
  return useContext(SinceContext)
}

const KIND_TEXT: Record<ChangeKind, string> = {
  commented: 'text-k-fact',
  closed: 'text-status-closed',
  new: 'text-primary-text',
  updated: 'text-warn',
}

/** Small accent dot on a card or row that changed since the last visit. */
export function ChangedDot({ id }: { id: string }) {
  const kind = useSince().changes.get(id)
  if (!kind) return null
  return (
    <span
      className="inline-block size-1.5 shrink-0 rounded-full bg-primary-text"
      title={`${CHANGE_LABEL[kind]} since you last looked`}
      role="img"
      aria-label={`${CHANGE_LABEL[kind]} since you last looked`}
    />
  )
}

function sinceLabel(since: number): string {
  return new Date(since).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SinceBand({
  since,
  change,
  beadsById,
  onDismiss,
}: {
  since: number
  change: ChangeSet
  beadsById: Map<string, Bead>
  onDismiss: () => void
}) {
  const [open, setOpen] = useState(false)
  if (change.total === 0) return null
  const rows = [...change.byBead].slice(0, 40)
  return (
    <section
      aria-label="Since you last looked"
      className="mb-3 rounded-[8px] bg-card px-3 py-2 ring-1 ring-inset ring-border"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        <span
          className="size-1.5 shrink-0 rounded-full bg-primary-text"
          aria-hidden="true"
        />
        <span className="font-medium">Since {sinceLabel(since)}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
          {changeParts(change.counts).map((p, i) => (
            <span key={p.kind}>
              {i > 0 ? <span aria-hidden="true">· </span> : null}
              <span
                className={cn('font-semibold tabular-nums', KIND_TEXT[p.kind])}
              >
                {p.count}
              </span>{' '}
              {CHANGE_LABEL[p.kind]}
            </span>
          ))}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-xs"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? (
              <ChevronDown className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden="true" />
            )}
            {open ? 'Hide' : 'Show'}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss"
            title="Mark as seen"
            onClick={onDismiss}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </span>
      </div>
      {open ? (
        <ul className="mt-2 flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {rows.map(([id, kind]) => {
            const bead = beadsById.get(id)
            return (
              <li key={id}>
                <InteractiveRow
                  variant="plain"
                  size="flush"
                  disabled={!bead}
                  beadId={id}
                  className="flex min-w-0 items-center gap-2 rounded-[6px] px-1.5 py-1 text-[12.5px] hover:bg-card-hover"
                >
                  <span
                    className={cn(
                      'w-[4.5rem] shrink-0 font-mono text-[10.5px] tracking-[0.05em] uppercase',
                      KIND_TEXT[kind],
                    )}
                  >
                    {CHANGE_LABEL[kind]}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                    {id}
                  </span>
                  <span className="min-w-0 truncate">{bead?.title}</span>
                </InteractiveRow>
              </li>
            )
          })}
          {change.total > rows.length ? (
            <li className="px-1.5 py-1 text-[11.5px] text-muted-foreground">
              and {change.total - rows.length} more
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  )
}
