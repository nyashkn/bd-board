import { describe, expect, it } from 'vitest'

import {
  carrySearch,
  carryToProject,
  closeSteps,
  quickFilterSearch,
} from './nav-context'
import {
  readCollapsed,
  readScroll,
  writeCollapsed,
  writeScroll,
} from './view-state'

const prev = {
  q: 'lead',
  p: '1',
  l: 'a',
  closed: '30d',
  view: 'status',
  sort: 'recent',
  tab: 'hierarchy',
  bead: 'x-1',
  assignee: 'kn',
}

describe('carrySearch', () => {
  it('keeps view state, drops tab/bead/assignee', () => {
    expect(carrySearch(prev, { tab: 'board' })).toEqual({
      q: 'lead',
      p: '1',
      l: 'a',
      closed: '30d',
      view: 'status',
      sort: 'recent',
      tab: 'board',
    })
  })
  it('undefined removes a key', () => {
    expect(carrySearch(prev, { q: undefined })).not.toHaveProperty('q')
  })
})

describe('carryToProject / quickFilterSearch', () => {
  it('drops labels when changing project', () => {
    const out = carryToProject(prev)
    expect(out).not.toHaveProperty('l')
    expect(out.q).toBe('lead')
  })
  it('quick filters merge over the current state', () => {
    expect(quickFilterSearch(prev, { ready: '1' })).toMatchObject({
      q: 'lead',
      ready: '1',
      assignee: 'kn',
    })
  })
})

describe('closeSteps', () => {
  it('pops what the modal pushed', () => {
    expect(closeSteps(3, 4)).toBe(1)
    expect(closeSteps(3, 5)).toBe(2)
  })
  it('replaces when loaded directly or already back at base', () => {
    expect(closeSteps(null, 4)).toBe(0)
    expect(closeSteps(3, 3)).toBe(0)
  })
})

describe('view-state storage', () => {
  const mem = () => {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    }
  }
  it('round-trips collapsed lanes per project', () => {
    const s = mem()
    writeCollapsed('a', new Set(['epic:1']), s)
    expect([...readCollapsed('a', s)]).toEqual(['epic:1'])
    expect(readCollapsed('b', s).size).toBe(0)
  })
  it('round-trips scroll and survives a throwing store', () => {
    const s = mem()
    writeScroll('a', 'board', 1250.4, s)
    expect(readScroll('a', 'board', s)).toBe(1250)
    const bad = {
      getItem: (): string | null => {
        throw new Error('x')
      },
      setItem: (): void => {
        throw new Error('x')
      },
    }
    expect(readScroll('a', 'board', bad)).toBe(0)
    expect(() => writeScroll('a', 'board', 5, bad)).not.toThrow()
    expect(readCollapsed('a', bad).size).toBe(0)
  })
})
