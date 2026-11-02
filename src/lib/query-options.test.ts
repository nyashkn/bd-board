import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  projectKnowledgeQueryOptions,
  projectsQueryOptions,
} from './query-options'

const calls = { export: 0, projects: 0, list: 0 }

vi.mock('@/lib/core', () => ({
  connectorFor: () => ({
    projectKnowledge: async () => {
      calls.export++
      return { knowledge: [], comments: [] }
    },
  }),
}))
vi.mock('@/lib/server', () => ({
  getProjects: async () => {
    calls.projects++
    return []
  },
}))

// The pre-change options (staleTime 4 s / 5 s), kept to show the before count.
const oldKnowledge = () => ({
  queryKey: ['project-knowledge', 'p'],
  queryFn: async () => {
    calls.export++
    return { knowledge: [], comments: [] }
  },
  staleTime: 4000,
})

/** Open then close the bead modal `n` times, 6 s apart (a user switching beads). */
async function switchBeads(qc: QueryClient, options: () => object, n: number) {
  for (let i = 0; i < n; i++) {
    const obs = new QueryObserver(qc, { ...options(), enabled: true } as never)
    const unsub = obs.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(6000)
    unsub()
  }
}

describe('query hygiene on bead open and switch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    calls.export = calls.projects = calls.list = 0
  })
  afterEach(() => vi.useRealTimers())

  it('before: every switch after 4 s re-runs export', async () => {
    await switchBeads(new QueryClient(), oldKnowledge, 5)
    expect(calls.export).toBe(5)
  })

  it('after: 5 bead switches cost one export and no projects or list', async () => {
    await switchBeads(
      new QueryClient(),
      () => projectKnowledgeQueryOptions('p'),
      5,
    )
    expect(calls.export).toBe(1)
    expect(calls.projects).toBe(0)
    expect(calls.list).toBe(0)
  })

  it('a feed invalidation still refreshes an open modal exactly once', async () => {
    const qc = new QueryClient()
    const obs = new QueryObserver(qc, projectKnowledgeQueryOptions('p'))
    obs.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(10)
    await qc.invalidateQueries({ queryKey: ['project-knowledge', 'p'] })
    expect(calls.export).toBe(2)
  })

  it('a closed modal (enabled: false) does not re-export on a feed change', async () => {
    const qc = new QueryClient()
    const obs = new QueryObserver(qc, {
      ...projectKnowledgeQueryOptions('p'),
      enabled: false,
    })
    obs.subscribe(() => {})
    await qc.invalidateQueries({ queryKey: ['project-knowledge', 'p'] })
    expect(calls.export).toBe(0)
  })

  it('projects: three observers share one fetch', async () => {
    const qc = new QueryClient()
    for (let i = 0; i < 3; i++)
      new QueryObserver(qc, projectsQueryOptions()).subscribe(() => {})
    await vi.advanceTimersByTimeAsync(10)
    expect(calls.projects).toBe(1)
    // A bead modal mounting later inside the stale window adds nothing.
    await switchBeads(qc, () => projectsQueryOptions(), 2)
    expect(calls.projects).toBe(1)
  })
})
