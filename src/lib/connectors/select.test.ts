import { describe, expect, it } from 'vitest'

import { isConnectionError, parseDoltShow, resolveCandidates } from './select'
import { parseRegistryEntry, RegistryError } from '../registry'

const base = { id: 'a', path: '/p', label: 'A' }
const BD = { kind: 'bd-cli', url: 'bd:' }

describe('registry sources', () => {
  it('keeps a valid ordered list', () => {
    const sources = [
      'mysql://127.0.0.1:3307/db',
      'https://x.test/m.json',
      'bd:',
    ]
    expect(parseRegistryEntry({ ...base, sources }, 0).sources).toEqual(sources)
  })

  it('leaves entries without sources unchanged', () => {
    expect(parseRegistryEntry(base, 0)).toEqual(base)
  })

  it.each([['ftp://x'], ['http://insecure.test'], [3], ['']])(
    'rejects a bad entry %j',
    (bad) => {
      expect(() => parseRegistryEntry({ ...base, sources: [bad] }, 0)).toThrow(
        RegistryError,
      )
    },
  )

  it.each(['bd:', { a: 1 }, 3])('rejects a non-array %j', (bad) => {
    expect(() => parseRegistryEntry({ ...base, sources: bad }, 0)).toThrow(
      /sources/,
    )
  })
})

describe('parseDoltShow', () => {
  it('reads embedded mode', () => {
    expect(
      parseDoltShow(
        '{"backend":"dolt","data_dir":"/d","database":"hq","embedded":true,"schema_version":9}',
      ),
    ).toEqual({ embedded: true, database: 'hq', schemaVersion: 9 })
  })

  it('reads server mode', () => {
    expect(
      parseDoltShow(
        '{"backend":"dolt","connection_ok":true,"database":"hq","embedded":false,"host":"127.0.0.1","port":61687,"schema_version":1,"tls":false}',
      ),
    ).toEqual({
      embedded: false,
      host: '127.0.0.1',
      port: 61687,
      database: 'hq',
      connectionOk: true,
      schemaVersion: 1,
    })
  })

  it.each(['', 'nope', '[]', 'null', '{"embedded":"yes"}', '{"host":"x"}'])(
    'turns %j into an error',
    (raw) => {
      expect(parseDoltShow(raw)).toHaveProperty('error')
    },
  )
})

describe('resolveCandidates', () => {
  const server = {
    embedded: false,
    connectionOk: true,
    host: '127.0.0.1',
    port: 3307,
    database: 'hq',
  }

  it('embedded: bd-cli only', () => {
    expect(resolveCandidates([], { embedded: true, database: 'hq' })).toEqual([
      BD,
    ])
  })

  it('reachable server: dolt-sql first, bd-cli second', () => {
    expect(resolveCandidates([], server)).toEqual([
      { kind: 'dolt-sql', url: 'mysql://127.0.0.1:3307/hq' },
      BD,
    ])
  })

  it('unreachable or incomplete server: bd-cli only', () => {
    expect(resolveCandidates([], { ...server, connectionOk: false })).toEqual([
      BD,
    ])
    expect(resolveCandidates([], { embedded: false })).toEqual([BD])
  })

  it('probe error: bd-cli only', () => {
    expect(resolveCandidates([], { error: 'boom' })).toEqual([BD])
  })

  it('explicit sources win, in order, even over a server probe', () => {
    expect(
      resolveCandidates(
        ['https://x.test/m.json', 'bd:', 'mysql://h:1/d'],
        server,
      ),
    ).toEqual([
      { kind: 'http-snapshot', url: 'https://x.test/m.json' },
      BD,
      { kind: 'dolt-sql', url: 'mysql://h:1/d' },
    ])
  })

  it('explicit sources ignore the probe, errors included', () => {
    expect(resolveCandidates(['mysql://h:1/d'], { error: 'x' })).toEqual([
      { kind: 'dolt-sql', url: 'mysql://h:1/d' },
    ])
  })
})

describe('isConnectionError', () => {
  it.each([
    new Error('connect ECONNREFUSED 127.0.0.1:3307'),
    'Connection refused',
    new Error('socket hang up'),
    Object.assign(new Error('x'), { code: 'ECONNRESET' }),
    'failed to fetch',
  ])('treats %j as a connection error', (err) => {
    expect(isConnectionError(err)).toBe(true)
  })

  it.each([
    new Error('bead not found: bd-1'),
    'Invalid status',
    new Error('project "x" is read-only; writes are refused'),
    new Error('bd exited with status 1'),
    undefined,
  ])('treats %j as a domain error', (err) => {
    expect(isConnectionError(err)).toBe(false)
  })
})
