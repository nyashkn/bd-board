import { useCallback, useEffect, useRef } from 'react'

import { readScroll, writeScroll } from '@/lib/view-state'

/** Ref + onScroll for a scroll container whose position should survive a view switch. */
export function useScrollMemory(project: string, tab: string) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const top = readScroll(project, tab)
    if (top && ref.current) ref.current.scrollTop = top
  }, [project, tab])
  const onScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) =>
      writeScroll(project, tab, event.currentTarget.scrollTop),
    [project, tab],
  )
  return { ref, onScroll }
}
