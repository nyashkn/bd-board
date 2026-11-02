import type * as OsModule from 'node:os'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  bdExec,
  discoverProjects,
  planLaunch,
  resolveRealBd,
  resolveWritableDir,
  bdAdapter,
  probeDoltMode,
} from './bd'
import { loadRegistry, parseRegistryEntry } from './registry'

const base = { id: 'a', path: '/p', label: 'A' }

// os.homedir() ignores a stubbed HOME inside vitest workers, so fake it explicitly.
vi.mock('node:os', async (importOriginal) => {
  const real = await importOriginal<typeof OsModule>()
  return {
    ...real,
    homedir: () => process.env['BDB_FAKE_HOME'] ?? real.homedir(),
  }
})

describe('parseRegistryEntry', () => {
  it('keeps entries without the optional fields unchanged', () => {
    expect(parseRegistryEntry(base, 0)).toEqual(base)
  })

  it('accepts readonly and trims filterLabel', () => {
    expect(
      parseRegistryEntry({ ...base, readonly: true, filterLabel: ' wo ' }, 0),
    ).toEqual({ ...base, readonly: true, filterLabel: 'wo' })
  })

  it.each([
    [{ readonly: 'yes' }, /readonly/],
    [{ readonly: 1 }, /readonly/],
    [{ filterLabel: '' }, /filterLabel/],
    [{ filterLabel: 3 }, /filterLabel/],
    [{ id: 5 }, /"id"/],
  ])('rejects %j', (patch, message) => {
    expect(() => parseRegistryEntry({ ...base, ...patch }, 0)).toThrow(message)
  })
})

describe('planLaunch', () => {
  const deps = {
    candidates: ['/x/bd', 'bd'],
    shim: () => '/repo/scripts/readonly/bd-readonly',
    realBd: () => '/x/bd',
  }

  it('leaves a normal project exactly as before', () => {
    expect(planLaunch(undefined, deps)).toEqual({ candidates: deps.candidates })
    expect(planLaunch({ readonly: false, filterLabel: 'wo' }, deps)).toEqual({
      candidates: deps.candidates,
    })
  })

  it('runs the shim for a readonly project, with REAL_BD', () => {
    expect(planLaunch({ readonly: true }, deps)).toEqual({
      candidates: ['/repo/scripts/readonly/bd-readonly'],
      env: { REAL_BD: '/x/bd', BD_FILTER_LABEL: '' },
    })
  })

  it('passes filterLabel only together with readonly', () => {
    expect(planLaunch({ readonly: true, filterLabel: 'wo' }, deps).env).toEqual(
      {
        REAL_BD: '/x/bd',
        BD_FILTER_LABEL: 'wo',
      },
    )
  })
})

describe('resolveRealBd', () => {
  it('returns the first usable candidate as a path', () => {
    const exe = (f: string) => f === '/y/bd'
    expect(resolveRealBd(['/x/bd', '/y/bd'], exe)).toBe('/y/bd')
  })

  it('throws when nothing is usable', () => {
    expect(() => resolveRealBd(['/x/bd'], () => false)).toThrow(/bd not found/)
  })
})

describe('with a fake HOME and a fake bd', () => {
  let tmp: string
  let proj: string
  let proj2: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bdb-ro-'))
    proj = join(tmp, 'proj')
    mkdirSync(join(tmp, 'home', '.config', 'bd-board'), { recursive: true })
    proj2 = join(tmp, 'proj2')
    mkdirSync(proj)
    mkdirSync(proj2)
    // Fake bd: prints its arguments and the filter env, never touches anything.
    const bd = join(tmp, 'bd')
    writeFileSync(
      bd,
      '#!/bin/sh\necho "ARGS:$*"\necho "FILTER:${BD_FILTER_LABEL-unset}"\n',
    )
    chmodSync(bd, 0o755)
    writeFileSync(
      join(tmp, 'home', '.config', 'bd-board', 'projects.json'),
      JSON.stringify({
        version: 1,
        projects: [
          { id: 'rw', path: proj, label: 'RW' },
          {
            id: 'ro',
            path: proj2,
            label: 'RO',
            readonly: true,
            filterLabel: 'wo',
          },
          { id: 'ex', path: proj, label: 'EX', sources: ['mysql://h:1/d'] },
        ],
      }),
    )
    vi.stubEnv('BDB_FAKE_HOME', join(tmp, 'home'))
    vi.stubEnv('BD_BIN', bd)
    vi.stubEnv('BD_FILTER_LABEL', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(tmp, { recursive: true, force: true })
  })

  it('loads the optional fields', async () => {
    const entries = await loadRegistry()
    expect(entries[0]).toEqual({ id: 'rw', path: proj, label: 'RW' })
    expect(entries[1]).toMatchObject({ readonly: true, filterLabel: 'wo' })
  })

  it('refuses a registry with a wrongly typed readonly', async () => {
    writeFileSync(
      join(tmp, 'home', '.config', 'bd-board', 'projects.json'),
      JSON.stringify({
        version: 1,
        projects: [{ ...base, readonly: 'true' }],
      }),
    )
    await expect(loadRegistry()).rejects.toThrow(/readonly/)
  })

  it('spawns plain bd for a normal project', async () => {
    const r = await bdExec(proj, ['show', 'x'])
    expect(r.stdout).toContain('ARGS:show x')
    expect(r.env['REAL_BD']).toBeUndefined()
  })

  it('spawns the shim for a readonly project: reads pass with --readonly and the filter', async () => {
    const r = await bdExec(proj2, ['show', 'x'])
    expect(r.bin).toMatch(/scripts\/readonly\/bd-readonly$/)
    expect(r.stdout).toContain('ARGS:--readonly show x')
    expect(r.stdout).toContain('FILTER:wo')
  })

  it('the shim refuses writes in a readonly project', async () => {
    for (const args of [
      ['update', 'x', '--title', 't'],
      ['comments', 'add', 'x', 'hi'],
      ['config', 'set', 'a', 'b'],
    ]) {
      const r = await bdExec(proj2, args)
      expect(r.code).toBe(1)
      expect(r.stderr).toMatch(/read-only/)
      expect(r.stdout).toBe('')
    }
  })

  it('probeDoltMode reports garbage as an error and skips bd for explicit sources', async () => {
    expect(await probeDoltMode('rw')).toMatchObject({
      error: expect.any(String),
    })
    // The fake bd would print non-JSON; explicit sources must come back without running it.
    expect(await probeDoltMode('ex')).toEqual({
      error: 'not probed: explicit sources',
      sources: ['mysql://h:1/d'],
    })
  })

  it('reports readonly and filterLabel on the discovered project', async () => {
    const list = await discoverProjects()
    const ro = list.find((p) => p.id === 'ro')
    expect(ro).toMatchObject({ readonly: true, filterLabel: 'wo' })
    expect(list.find((p) => p.id === 'rw')?.readonly).toBeUndefined()
  })

  it('refuses writes for a readonly project, allows them otherwise', async () => {
    await expect(resolveWritableDir('ro')).rejects.toThrow(/read-only/)
    await expect(resolveWritableDir('rw')).resolves.toBe(proj)
    for (const write of [
      () => bdAdapter.updateBeadStatus('ro', 'x', 'closed'),
      () => bdAdapter.updateBead('ro', 'x', { title: 't' }),
      () => bdAdapter.deleteBead('ro', 'x'),
      () => bdAdapter.previewDeleteBead('ro', 'x'),
      () => bdAdapter.createBead('ro', { title: 't' }),
      () => bdAdapter.addComment('ro', 'x', 'hi'),
      () => bdAdapter.enableEventsJournal('ro'),
    ]) {
      await expect(write()).rejects.toThrow(/read-only/)
    }
  })
})
