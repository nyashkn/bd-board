import { useCallback, useEffect, useRef, useState } from 'react'

import { copyWithFeedback } from '@/lib/copy-text'
import type { CopyState } from '@/lib/copy-text'

/** Clipboard copy with a 2 s `copied` / `failed` state. */
export function useCopy(): [CopyState, (text: string) => void] {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = useCallback(
    (text: string) => void copyWithFeedback(text, setState, timer),
    [],
  )
  return [state, copy]
}
