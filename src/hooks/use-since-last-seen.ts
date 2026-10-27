import { useCallback, useEffect, useState } from 'react'

import { baselineOnReturn, readLastSeen, writeLastSeen } from '@/lib/activity'

/**
 * The time the user last looked at a project, for the "since you last looked" band. It is
 * stored when the tab is hidden or closed, and the band's baseline moves to it when the user
 * comes back after a real absence. A first visit has no baseline (nothing to compare against).
 */
export function useSinceLastSeen(project: string): {
  since: number | null
  dismiss: () => void
} {
  const [since, setSince] = useState<number | null>(null)

  useEffect(() => {
    const stored = readLastSeen(project)
    setSince(stored)
    if (stored === null) writeLastSeen(project, Date.now())

    let hiddenAt = 0
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        writeLastSeen(project, hiddenAt)
      } else if (hiddenAt) {
        const now = Date.now()
        setSince((cur) => baselineOnReturn(cur, hiddenAt, now))
        hiddenAt = 0
      }
    }
    const onHide = () => writeLastSeen(project, Date.now())
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onHide)
    }
  }, [project])

  const dismiss = useCallback(() => {
    setSince(null)
    writeLastSeen(project, Date.now())
  }, [project])

  return { since, dismiss }
}
