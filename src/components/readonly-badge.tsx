import { createContext, useContext } from 'react'
import { Lock } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

/** true inside a read-only project: write controls are hidden, not just refused. */
export const ReadonlyContext = createContext(false)

export function useReadonly(): boolean {
  return useContext(ReadonlyContext)
}

export function ReadonlyBadge({ filterLabel }: { filterLabel?: string }) {
  return (
    <Badge
      variant="outline"
      className="gap-1"
      title={
        filterLabel
          ? `Read-only project. Showing "${filterLabel}" only; writes are refused.`
          : 'Read-only project: writes are refused.'
      }
    >
      <Lock aria-hidden="true" />
      Read-only
    </Badge>
  )
}
