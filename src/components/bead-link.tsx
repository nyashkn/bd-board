import * as React from 'react'
import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { isModifiedClick, withBead } from '@/lib/bead-link'
import { isDesktopApp } from '@/lib/server'

/**
 * A real `<a href="?bead=<id>">` for the current project route. A plain click navigates client-side
 * (modal over the board, history push); Cmd/Ctrl/Shift/middle-click fall through to the browser.
 * In the desktop app there is no second window to open, so modified clicks do nothing.
 */
export function BeadLink({
  beadId,
  onClick,
  onKeyDown,
  ...props
}: { beadId: string } & Omit<React.ComponentProps<'a'>, 'href'>) {
  return (
    <Link
      to="."
      search={(prev: object) => withBead(prev, beadId)}
      onClick={(e) => {
        onClick?.(e)
        if (isDesktopApp() && isModifiedClick(e)) e.preventDefault()
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        // Anchors activate on Enter only; cards and rows opened on Space as buttons.
        if (e.key === ' ' && e.target === e.currentTarget) {
          e.preventDefault()
          e.currentTarget.click()
        }
      }}
      {...props}
    />
  )
}

/** A `Button` that is a `BeadLink` when `beadId` is known, else a disabled button. */
export function BeadLinkButton({
  beadId,
  children,
  ...props
}: { beadId?: string } & Omit<React.ComponentProps<typeof Button>, 'asChild'>) {
  if (!beadId)
    return (
      <Button {...props} disabled>
        {children}
      </Button>
    )
  return (
    <Button asChild {...props}>
      <BeadLink beadId={beadId}>{children}</BeadLink>
    </Button>
  )
}
