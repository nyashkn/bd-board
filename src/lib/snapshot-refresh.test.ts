import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  REFRESH_DEBOUNCE_MS,
  REFRESH_MAX_WAIT_MS,
  createRefresher,
} from './snapshot-refresh.ts'

const TOOK_MS = 500

function setup() {
  const log: string[] = []
  const refresher = createRefresher({
    full: () =>
      new Promise((resolve) => {
        log.push('full:start')
        setTimeout(() => {
          log.push('full:end')
          resolve(undefined)
        }, TOOK_MS)
      }),
    comments: async (ids) => {
      log.push(`comments:${ids.join(',')}`)
    },
  })
  const count = (prefix: string) =>
    log.filter((l) => l.startsWith(prefix)).length
  return { refresher, log, count }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('feed-driven refresh pacing', () => {
  it('debounces a burst into one full refresh', async () => {
    const { refresher, count } = setup()
    for (let i = 0; i < 10; i++) {
      refresher.change({ issueIds: [`b${i}`], ops: ['update'] })
      await vi.advanceTimersByTimeAsync(50)
    }
    expect(count('full:start')).toBe(0)
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    expect(count('full:start')).toBe(1)
    await vi.advanceTimersByTimeAsync(TOOK_MS * 4)
    expect(count('full:start')).toBe(1)
  })

  it('events during a run cost one trailing refresh, started no sooner than the last took', async () => {
    const { refresher, log, count } = setup()
    refresher.change({ issueIds: ['a'], ops: ['update'] })
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    expect(count('full:start')).toBe(1)
    // 30 more events while it runs
    for (let i = 0; i < 30; i++) {
      refresher.change({ issueIds: [`b${i}`], ops: ['update'] })
      await vi.advanceTimersByTimeAsync(10)
    }
    // the loop took 300 ms of the 500 ms the first run needs
    await vi.advanceTimersByTimeAsync(TOOK_MS - 30 * 10)
    expect(log.filter((l) => l === 'full:end')).toHaveLength(1)
    // gap: it took 500 ms, so the next one waits another 500 ms after the end
    await vi.advanceTimersByTimeAsync(TOOK_MS - 50)
    expect(count('full:start')).toBe(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(count('full:start')).toBe(2)
    await vi.advanceTimersByTimeAsync(TOOK_MS * 10)
    expect(count('full:start')).toBe(2) // at most 2 for the whole burst
  })

  it('a sustained burst still refreshes: the debounce cannot defer past the max wait', async () => {
    const { refresher, count } = setup()
    // an event every 100 ms, never 300 ms of quiet
    for (let t = 0; t < 3000; t += 100) {
      refresher.change({ issueIds: ['a'], ops: ['update'] })
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(count('full:start')).toBeGreaterThanOrEqual(2)
    expect(count('full:start')).toBeLessThanOrEqual(
      Math.ceil(3000 / REFRESH_MAX_WAIT_MS) + 1,
    )
    refresher.dispose()
  })

  it('comment-only events fetch those comments and run no full refresh', async () => {
    const { refresher, log, count } = setup()
    refresher.change({ issueIds: ['a'], ops: ['comment'] })
    refresher.change({ issueIds: ['b', 'a'], ops: ['comment'] })
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    expect(log).toEqual(['comments:a,b'])
    expect(count('full')).toBe(0)
  })

  it('any other or unknown op in the burst means a full refresh instead', async () => {
    for (const ops of [['comment', 'update'], ['dep_add'], [], undefined]) {
      const { refresher, log } = setup()
      refresher.change({ issueIds: ['a'], ops: ['comment'] })
      refresher.change({ issueIds: ['a'], ops })
      await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
      expect(log).toEqual(['full:start'])
    }
  })

  it('full() is paced like any refresh, and dispose cancels what is pending', async () => {
    const { refresher, count } = setup()
    refresher.full()
    refresher.full()
    await vi.advanceTimersByTimeAsync(1)
    expect(count('full:start')).toBe(1)
    refresher.change({ issueIds: ['a'], ops: ['update'] })
    refresher.dispose()
    await vi.advanceTimersByTimeAsync(TOOK_MS * 5)
    expect(count('full:start')).toBe(1)
  })
})
