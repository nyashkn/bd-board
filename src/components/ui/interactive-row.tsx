import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import { BeadLink } from '@/components/bead-link'
import { cn } from '@/lib/utils'

const interactiveRowVariants = cva(
  'block w-full text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default',
  {
    variants: {
      variant: {
        surface:
          'bg-card ring-1 ring-inset ring-border hover:bg-card-hover hover:ring-ring/40 disabled:hover:bg-card disabled:hover:ring-border',
        plain: '',
      },
      size: {
        compact: 'flex items-center gap-2.5 rounded-[8px] px-[10px] py-2',
        cozy: 'flex gap-[11px] rounded-[9px] px-3 py-2.5',
        flush: '',
      },
    },
    defaultVariants: {
      variant: 'surface',
      size: 'compact',
    },
  },
)

interface InteractiveRowProps
  extends
    React.ComponentProps<'button'>,
    VariantProps<typeof interactiveRowVariants> {
  active?: boolean
  /** Render as a real link to `?bead=<id>` instead of a button (stays a button when disabled). */
  beadId?: string
}

function InteractiveRow({
  className,
  variant,
  size,
  active = false,
  beadId,
  ...props
}: InteractiveRowProps) {
  const common = {
    'data-slot': 'interactive-row',
    'data-active': active || undefined,
    className: cn(
      interactiveRowVariants({ variant, size }),
      active && 'ring-ring/45 hover:bg-card hover:ring-ring/45',
      className,
    ),
  }
  if (beadId && !props.disabled) {
    return (
      <BeadLink
        beadId={beadId}
        {...common}
        {...(props as React.ComponentProps<'a'>)}
      />
    )
  }
  return <button type="button" {...common} {...props} />
}

export { InteractiveRow, interactiveRowVariants }
