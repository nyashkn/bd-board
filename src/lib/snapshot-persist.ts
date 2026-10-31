import { snapshotKey } from './snapshot-store.ts'
import { SNAPSHOT_SCHEMA_VERSION } from './snapshot.ts'

import type { QueryClient } from '@tanstack/react-query'

/**
 * Persists the snapshot queries (['snapshot', project], nothing else) so a cold start paints
 * the last board before any bd call returns. The restored data is stale: the normal refresh
 * (background lane) revalidates it. Hand-rolled instead of @tanstack/query-persist-client-core:
 * one key family, one store, and LRU eviction would need custom code on top of it anyway.
 */

export const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000
export const PERSIST_MAX_PROJECTS = 8
const SAVE_DELAY = 1000

interface Entry {
  buster: string
  savedAt: number
  usedAt: number
  data: unknown
}

/** The storage seam: IndexedDB in the app, a Map in tests. */
export interface SnapshotStorage {
  all: () => Promise<[string, unknown][]>
  set: (project: string, entry: Entry) => Promise<void>
  del: (project: string) => Promise<void>
}

export function idbStorage(name = 'bd-board'): SnapshotStorage {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1)
      req.onupgradeneeded = () => req.result.createObjectStore('snapshots')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  const run = async <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ) => {
    const db = await open()
    try {
      return await new Promise<T>((resolve, reject) => {
        const req = fn(
          db.transaction('snapshots', mode).objectStore('snapshots'),
        )
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    } finally {
      db.close()
    }
  }
  return {
    async all() {
      const keys = await run('readonly', (s) => s.getAllKeys())
      const values = await run('readonly', (s) => s.getAll())
      return keys.map((k, i) => [String(k), values[i]])
    },
    async set(project, entry) {
      await run('readwrite', (s) => s.put(entry, project))
    },
    async del(project) {
      await run('readwrite', (s) => s.delete(project))
    },
  }
}

/** Desktop always; the web build only on a loopback origin (the data is local bead text). */
export function persistenceAllowed(isDesktop: boolean): boolean {
  if (typeof indexedDB === 'undefined') return false
  if (isDesktop) return true
  return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
}

const projectOf = (key: readonly unknown[]) =>
  key[0] === 'snapshot' && typeof key[1] === 'string' ? key[1] : undefined

const valid = (e: unknown, now: number): e is Entry => {
  const x = e as Partial<Entry> | null
  return (
    !!x &&
    typeof x === 'object' &&
    x.buster === SNAPSHOT_SCHEMA_VERSION &&
    typeof x.savedAt === 'number' &&
    typeof x.usedAt === 'number' &&
    now - x.savedAt <= PERSIST_MAX_AGE &&
    !!x.data &&
    typeof x.data === 'object'
  )
}

let active: ReturnType<typeof persistSnapshots> | undefined

export function persistSnapshots(
  client: QueryClient,
  storage: SnapshotStorage,
  { now = Date.now, delay = SAVE_DELAY } = {},
) {
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let restoring = false // a restore is not a use: it must not bump usedAt
  // Storage failures (quota, private mode, corrupt db) must never break the app.
  const quiet = (p: Promise<unknown>) => p.catch(() => undefined)

  // Keep the newest PERSIST_MAX_PROJECTS by last use; drop invalid entries quietly.
  async function prune(): Promise<[string, Entry][]> {
    const good: [string, Entry][] = []
    for (const [project, e] of await storage.all()) {
      if (valid(e, now())) good.push([project, e])
      else await storage.del(project)
    }
    good.sort((a, b) => b[1].usedAt - a[1].usedAt)
    for (const [project] of good.splice(PERSIST_MAX_PROJECTS))
      await storage.del(project)
    return good
  }

  async function flush() {
    clearTimeout(timer)
    timer = undefined
    const projects = [...pending]
    pending.clear()
    for (const project of projects) {
      const state = client.getQueryState(snapshotKey(project))
      if (state?.data === undefined) continue
      await quiet(
        storage.set(project, {
          buster: SNAPSHOT_SCHEMA_VERSION,
          savedAt: state.dataUpdatedAt,
          usedAt: now(),
          data: state.data,
        }),
      )
    }
    await quiet(prune())
  }

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    const project = projectOf(event.query.queryKey)
    if (
      restoring ||
      project === undefined ||
      event.type !== 'updated' ||
      event.action.type !== 'success'
    )
      return
    pending.add(project)
    clearTimeout(timer)
    timer = setTimeout(() => void flush(), delay)
  })

  const restored = quiet(
    prune().then((entries) => {
      for (const [project, e] of entries) {
        // A fetch that already answered is fresher than the disk.
        if (client.getQueryData(snapshotKey(project)) !== undefined) continue
        restoring = true
        client.setQueryData(snapshotKey(project), e.data, {
          updatedAt: e.savedAt,
        })
        restoring = false
        void client.invalidateQueries({ queryKey: snapshotKey(project) })
      }
    }),
  )

  const persister = {
    restored,
    flush,
    async forget(project: string) {
      pending.delete(project)
      await quiet(storage.del(project))
    },
    stop() {
      unsubscribe()
      clearTimeout(timer)
      if (active === persister) active = undefined
    },
  }
  active = persister
  return persister
}

/** A project left the registry: drop its cached and persisted snapshot. */
export async function forgetSnapshot(client: QueryClient, project: string) {
  client.removeQueries({ queryKey: snapshotKey(project) })
  await active?.forget(project)
}
