import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import {
  PERSIST_MAX_AGE,
  PERSIST_MAX_PROJECTS,
  forgetSnapshot,
  persistSnapshots,
} from './snapshot-persist.ts'
import { SNAPSHOT_SCHEMA_VERSION } from './snapshot.ts'
import { snapshotKey } from './snapshot-store.ts'

import type { SnapshotStorage } from './snapshot-persist.ts'

const NOW = 1_000_000_000_000
const snap = (n: string) => ({ beads: [{ id: n }] })

function memory() {
  const map = new Map<string, any>()
  const storage: SnapshotStorage = {
    all: async () => [...map],
    set: async (k, v) => void map.set(k, v),
    del: async (k) => void map.delete(k),
  }
  return { map, storage }
}
const entry = (n: string, over = {}) => ({
  buster: SNAPSHOT_SCHEMA_VERSION,
  savedAt: NOW - 1000,
  usedAt: NOW - 1000,
  data: snap(n),
  ...over,
})
const start = (storage: SnapshotStorage) => {
  const client = new QueryClient()
  const p = persistSnapshots(client, storage, { now: () => NOW, delay: 0 })
  return { client, p }
}

describe('persisted snapshots', () => {
  it('restores before any fetch and then revalidates', async () => {
    const { map, storage } = memory()
    map.set('a', entry('a'))
    const { client, p } = start(storage)
    const queryFn = vi.fn(async () => snap('fresh'))
    expect(client.getQueryData(snapshotKey('a'))).toBeUndefined()
    await p.restored
    expect(client.getQueryData(snapshotKey('a'))).toEqual(snap('a'))
    expect(queryFn).not.toHaveBeenCalled()
    await client.fetchQuery({
      queryKey: snapshotKey('a'),
      queryFn,
      staleTime: 0,
    })
    expect(client.getQueryData(snapshotKey('a'))).toEqual(snap('fresh'))
  })

  it('discards a buster mismatch, corrupt data and expired entries', async () => {
    const { map, storage } = memory()
    map.set('old', entry('old', { buster: 'v0' }))
    map.set('bad', 'garbage')
    map.set('stale', entry('stale', { savedAt: NOW - PERSIST_MAX_AGE - 1 }))
    map.set('ok', entry('ok', { savedAt: NOW - PERSIST_MAX_AGE }))
    const { client, p } = start(storage)
    await p.restored
    expect([...map.keys()]).toEqual(['ok'])
    expect(client.getQueryData(snapshotKey('old'))).toBeUndefined()
    expect(client.getQueryData(snapshotKey('ok'))).toEqual(snap('ok'))
  })

  it('persists only snapshot keys', async () => {
    const { map, storage } = memory()
    const { client, p } = start(storage)
    await p.restored
    client.setQueryData(['projects'], [1])
    client.setQueryData(['snapshot', 'a'], snap('a'))
    client.setQueryData(['other', 'a'], 1)
    await p.flush()
    expect([...map.keys()]).toEqual(['a'])
    expect(map.get('a').buster).toBe(SNAPSHOT_SCHEMA_VERSION)
  })

  it('keeps the most recently used projects and evicts the oldest', async () => {
    const { map, storage } = memory()
    const total = PERSIST_MAX_PROJECTS + 2
    for (let i = 0; i < total; i++)
      map.set(`p${i}`, entry(`p${i}`, { usedAt: NOW - 100_000 + i }))
    const { client, p } = start(storage)
    await p.restored
    expect(map.size).toBe(PERSIST_MAX_PROJECTS)
    expect(map.has('p0')).toBe(false)
    expect(map.has('p1')).toBe(false)
    expect(map.has(`p${total - 1}`)).toBe(true)
    client.setQueryData(snapshotKey('new'), snap('new'))
    await p.flush()
    expect(map.size).toBe(PERSIST_MAX_PROJECTS)
    expect(map.has('new')).toBe(true)
    expect(map.has('p2')).toBe(false)
  })

  it('removing a project deletes its persisted entry', async () => {
    const { map, storage } = memory()
    map.set('a', entry('a'))
    map.set('b', entry('b'))
    const { client, p } = start(storage)
    await p.restored
    await forgetSnapshot(client, 'a')
    await p.flush()
    expect([...map.keys()]).toEqual(['b'])
    expect(client.getQueryData(snapshotKey('a'))).toBeUndefined()
  })
})
