import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { rumAction } from '@/lib/rum'
import { connectorFor } from '@/lib/core'
import { createRefresher } from '@/lib/snapshot-refresh'
import {
  refreshComments,
  refreshSnapshot,
  setFeedLive,
} from '@/lib/snapshot-store'
import { toErrorMessage } from '@/lib/utils'

import type { BeadFeedMessage, BeadFeedStatus } from '@/lib/types'

const FEED_RETRY_MS = 15_000

function loadSeq(project: string): number {
  try {
    const n = Number(localStorage.getItem(`bd-board:feed-seq:${project}`))
    return Number.isSafeInteger(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

function saveSeq(project: string, seq: number) {
  try {
    if (seq > loadSeq(project)) {
      localStorage.setItem(`bd-board:feed-seq:${project}`, String(seq))
    }
  } catch {
    // storage unavailable: the feed restarts from 0 next time
  }
}

export interface UseBeadFeedResult {
  status: BeadFeedStatus
  message?: string
}

export function useBeadFeed(
  project: string,
  readonly = false,
): UseBeadFeedResult {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<BeadFeedStatus>('connecting')
  const [message, setMessage] = useState<string | undefined>(undefined)
  // Projects whose journal we already tried to enable this session: a journal
  // that is still off afterwards must not loop enable -> resubscribe forever.
  const enableTried = useRef(new Set<string>())
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setStatus('connecting')
    setMessage(undefined)
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const refresher = createRefresher({
      full: () => {
        // Palette index and artifact views follow the board; they refetch only while observed.
        void queryClient.invalidateQueries({
          queryKey: ['beads', project],
          refetchType: 'none',
        })
        void queryClient.invalidateQueries({ queryKey: ['artifact', project] })
        return refreshSnapshot(queryClient, project)
      },
      comments: (ids) => refreshComments(queryClient, project, ids),
    })

    const handle = (msg: BeadFeedMessage) => {
      setFeedLive(project, msg.type === 'live' || msg.type === 'change')
      switch (msg.type) {
        case 'live':
          saveSeq(project, msg.seq)
          setStatus('live')
          setMessage(undefined)
          refresher.full()
          break
        case 'change':
          saveSeq(project, msg.seq)
          refresher.change(msg)
          break
        case 'disabled':
          setStatus('disabled')
          if (enableTried.current.has(project)) {
            setStatus('unsupported')
            setMessage('The bd events journal is still disabled')
            break
          }
          if (readonly) {
            // The shim refuses `config set`; the owner enables it by hand once.
            setStatus('unsupported')
            setMessage(
              'Read-only project: run `bd config set events-journal true` in it once for live updates',
            )
            break
          }
          enableTried.current.add(project)
          connectorFor(project)
            .enableEventsJournal({ data: { project } })
            .then(() => {
              if (!cancelled) {
                toast.success('Live updates enabled for this project')
                setAttempt((a) => a + 1)
              }
            })
            .catch((err) => {
              if (cancelled) return
              setStatus('unsupported')
              setMessage(
                toErrorMessage(err, 'Failed to enable the events journal'),
              )
            })
          break
        case 'unsupported':
          setStatus('unsupported')
          setMessage(msg.message)
          break
        case 'error':
          rumAction('feed.reconnect')
          setStatus('error')
          setMessage(msg.message)
          clearTimeout(retryTimer)
          retryTimer = setTimeout(() => setAttempt((a) => a + 1), FEED_RETRY_MS)
          break
      }
    }

    const unsubscribe = connectorFor(project).subscribeFeed(
      project,
      loadSeq(project),
      handle,
    )
    return () => {
      cancelled = true
      unsubscribe()
      refresher.dispose()
      setFeedLive(project, false)
      clearTimeout(retryTimer)
    }
  }, [project, attempt, queryClient, readonly])

  return { status, message }
}
