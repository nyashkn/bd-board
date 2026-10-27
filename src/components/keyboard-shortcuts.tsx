import { useEffect, useState } from 'react'
import { Keyboard } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SHORTCUTS, keyAction, stepIndex } from '@/lib/keyboard'

const ITEM = '[data-bead-id]'
const SEARCH = 'input[aria-label="Search beads"]'

function visibleItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(ITEM)].filter(
    (el) => el.offsetParent !== null,
  )
}

/**
 * j/k and the arrow keys step through the beads on screen (any element with `data-bead-id`),
 * `/` focuses search, `?` lists the shortcuts. Enter opens the focused bead natively (it is a
 * button) and Esc is the dialogs' own. Nothing fires while typing or while a dialog or menu is open.
 */
export function KeyboardShortcuts() {
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target instanceof HTMLElement ? e.target : null
      if (e.key === 'Escape' && target?.matches(SEARCH)) {
        target.blur()
        return
      }
      const overlayOpen = Boolean(
        document.querySelector(
          '[role="dialog"],[role="menu"],[role="listbox"]',
        ),
      )
      const onBead = Boolean(target?.closest(ITEM))
      const arrowsOk =
        target === document.body ||
        (onBead && !target?.closest('[aria-label="Drag bead"]'))
      const action = keyAction(
        {
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          target,
        },
        overlayOpen,
        arrowsOk,
      )
      if (!action) return
      if (action.type === 'help') {
        e.preventDefault()
        setHelpOpen(true)
      } else if (action.type === 'focus-search') {
        const input = document.querySelector<HTMLInputElement>(SEARCH)
        if (!input) return
        e.preventDefault()
        input.focus()
        input.select()
      } else {
        const items = visibleItems()
        const current = items.findIndex((el) => el === target?.closest(ITEM))
        const next = items.at(stepIndex(current, action.delta, items.length))
        if (!next) return
        e.preventDefault()
        next.focus()
        next.scrollIntoView({ block: 'nearest' })
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        onClick={() => setHelpOpen(true)}
      >
        <Keyboard className="size-4" aria-hidden="true" />
      </Button>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Active on the Board and Hierarchy, except while typing.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="contents">
                <dt>
                  <kbd className="rounded-[4px] bg-muted px-1.5 py-0.5 font-mono text-xs ring-1 ring-inset ring-border">
                    {s.keys}
                  </kbd>
                </dt>
                <dd className="text-muted-foreground">{s.does}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  )
}
