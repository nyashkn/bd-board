import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Markdown from 'react-markdown'

import { BeadLink } from '@/components/bead-link'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { descriptionExcerpt } from '@/lib/bead-excerpt'
import { splitBeadRefs } from '@/lib/bead-refs'
import { PRIORITY_TEXT_CLASS, PRIORITY_WORD } from '@/lib/sort'
import { COLUMNS, mapStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

import type { Bead } from '@/lib/types'

const OPEN_DELAY = 250
const CLOSE_GRACE = 150

/**
 * `<Markdown>` that also renders `:::bead` directives as chips. Directive-free text goes through
 * a single `<Markdown>` exactly as before.
 */
export function BeadMarkdown({
  children,
  resolveBead,
}: {
  children: string
  resolveBead: (id: string) => Bead | undefined
}) {
  const segments = useMemo(() => splitBeadRefs(children), [children])
  if (segments.every((s) => s.type === 'text')) {
    return <Markdown>{children}</Markdown>
  }
  return (
    <>
      {segments.map((s, i) =>
        s.type === 'text' ? (
          <Markdown key={i}>{s.text}</Markdown>
        ) : (
          <p key={i} className="flex flex-wrap gap-1.5">
            {s.ids.map((id, j) => (
              <BeadRefChip key={`${id}:${j}`} id={id} bead={resolveBead(id)} />
            ))}
          </p>
        ),
      )}
    </>
  )
}

const chipClass =
  'inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted px-1.5 py-0.5 text-xs no-underline ring-1 ring-inset ring-border hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring'

/** A bead link chip; resolved beads get a preview card on hover or keyboard focus. */
export function BeadRefChip({ id, bead }: { id: string; bead?: Bead }) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const cardId = useId()
  useEffect(() => () => clearTimeout(timer.current), [])

  if (!bead) {
    return (
      <BeadLink
        beadId={id}
        className={cn(chipClass, 'font-mono text-muted-foreground italic')}
        title="Bead not found in this project"
      >
        {id}
      </BeadLink>
    )
  }

  const later = (next: boolean, ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), ms)
  }
  const show = () => later(true, OPEN_DELAY)
  const hide = () => later(false, CLOSE_GRACE)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span
          className="inline-flex max-w-full"
          // Esc inside 250 ms must cancel the pending open (an open card is closed by Radix).
          onKeyDown={(e) => e.key === 'Escape' && clearTimeout(timer.current)}
          // Touch has no hover: a tap just follows the link.
          onPointerEnter={(e) => e.pointerType !== 'touch' && show()}
          onPointerLeave={hide}
          onFocus={(e) => e.target.matches(':focus-visible') && show()}
          onBlur={hide}
          onClick={() => {
            clearTimeout(timer.current)
            setOpen(false)
          }}
        >
          <BeadLink
            beadId={id}
            className={chipClass}
            aria-describedby={open ? cardId : undefined}
          >
            <span className="font-mono">{id}</span>
            <span className="truncate">{bead.title}</span>
          </BeadLink>
        </span>
      </PopoverAnchor>
      <PopoverContent
        id={cardId}
        role="tooltip"
        align="start"
        className="w-80 motion-reduce:animate-none"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={() => clearTimeout(timer.current)}
        onPointerLeave={hide}
      >
        <BeadPreview bead={bead} />
      </PopoverContent>
    </Popover>
  )
}

function BeadPreview({ bead }: { bead: Bead }) {
  const column = mapStatus(bead.status).column
  const excerpt = descriptionExcerpt(bead.description)
  return (
    <div className="flex flex-col gap-1.5" data-testid="bead-ref-card">
      <div className="font-medium">{bead.title}</div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-mono">{bead.id}</span>
        <span>{COLUMNS.find((c) => c.key === column)?.label}</span>
        <span className={PRIORITY_TEXT_CLASS[bead.priority]}>
          {PRIORITY_WORD[bead.priority] ?? `P${bead.priority}`}
        </span>
        {bead.assignee ? <span>@{bead.assignee}</span> : null}
        {bead.parent ? <span>in {bead.parent}</span> : null}
      </div>
      {bead.labels?.length ? (
        <div className="flex flex-wrap gap-1">
          {bead.labels.map((l) => (
            <Badge key={l} variant="secondary">
              {l}
            </Badge>
          ))}
        </div>
      ) : null}
      {excerpt ? (
        <p className="text-xs whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">
          {excerpt}
        </p>
      ) : null}
    </div>
  )
}
