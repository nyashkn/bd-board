import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { copyWithFeedback } from './copy-text.ts'
import type { CopyState } from './copy-text.ts'
import { buildMigrationPrompt, MIGRATION_OPTIONS } from './migration-prompt.ts'
import type { MigrationContext } from './migration-prompt.ts'

const ctx: MigrationContext = {
  path: '/work/ledger',
  prefix: 'led',
  mode: 'embedded',
  bdVersion: '1.3.2',
}
const options = MIGRATION_OPTIONS.map((o) => o.value)

describe('buildMigrationPrompt', () => {
  it('interpolates the project context', () => {
    const p = buildMigrationPrompt(ctx, 'shared-server')
    expect(p).toContain('Project path: /work/ledger')
    expect(p).toContain('Issue prefix: led')
    expect(p).toContain('Current mode: embedded')
    expect(p).toContain('bd version: 1.3.2')
    expect(p).toContain('bd init -p led --shared-server')
  })

  it('says unknown, not undefined or null, for missing context', () => {
    const p = buildMigrationPrompt(
      { path: '/x', prefix: null, mode: 'unknown' },
      'remote-server',
    )
    expect(p).toContain('Issue prefix: unknown')
    expect(p).toContain('bd version: unknown')
    expect(p).toContain('-p <prefix>')
  })

  it.each(options)('%s: safety steps, numbers and report line', (o) => {
    const p = buildMigrationPrompt(ctx, o)
    expect(p).not.toMatch(/undefined|null|\[object/)
    for (const s of [
      'bd export -o ~/beads-backup.jsonl',
      '430 ms -> 89 ms',
      '4.3 s -> 0.13 s',
      'Never use `--force`, `--reinit-local` or `--discard-remote`',
      '## Rollback',
      'before and after counts',
    ])
      expect(p).toContain(s)
  })

  it('names what is specific to each option', () => {
    const b = buildMigrationPrompt(ctx, 'bucket-remote')
    expect(b).toContain("unknown url scheme: 's3'")
    expect(b).toContain('17.5 s')
    const r = buildMigrationPrompt(ctx, 'remote-server')
    for (const s of [
      '--server-host',
      '--server-port',
      '--server-tls',
      'BEADS_DOLT_PASSWORD',
      'credentials',
    ])
      expect(r).toContain(s)
    expect(buildMigrationPrompt(ctx, 'shared-server')).not.toContain('r2')
  })
})

// bd 1.3.2 help output, checked in as fixtures (`bd <cmd> --help`).
const help = (name: string) =>
  readFileSync(
    new URL(`./fixtures/bd-help/${name}.txt`, import.meta.url),
    'utf8',
  )

/** Every `bd ...` command the prompt shows: fenced lines and inline code. */
function bdCommands(prompt: string): string[] {
  const out: string[] = []
  let fenced = false
  for (const line of prompt.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced
    else if (fenced && line.startsWith('bd ')) out.push(line.split(' #')[0])
    for (const m of line.matchAll(/`(bd [^`]+)`/g)) out.push(m[1])
  }
  return out
}

describe('commands named in the prompt exist in bd 1.3.2', () => {
  const root = help('bd')
  const all = options.flatMap((o) => bdCommands(buildMigrationPrompt(ctx, o)))

  it('finds the commands', () => {
    expect(all).toContain(
      'bd init -p led --shared-server --non-interactive --skip-agents --skip-hooks',
    )
    expect(all.length).toBeGreaterThan(15)
  })

  it.each([...new Set(all)])('%s', (cmd) => {
    const [, sub, ...rest] = cmd.split(' | ')[0].split(/\s+/)
    // Top-level subcommand: a row in `bd --help`.
    if (!sub.startsWith('-'))
      expect(root).toMatch(new RegExp(`^ {2}${sub}\\s`, 'm'))
    else expect(root).toContain(sub)
    const flags = rest.filter((t) => /^--?[a-z]/i.test(t))
    const text =
      flags.length || sub === 'dolt'
        ? help(sub.startsWith('-') ? 'bd' : sub)
        : ''
    if (sub === 'dolt' && rest[0]) {
      expect(text).toMatch(
        new RegExp(`bd dolt ${rest[0]}\\b|^ {2}${rest[0]}\\s`, 'm'),
      )
    }
    for (const flag of flags) {
      expect(text, `${flag} in bd ${sub} --help`).toContain(flag)
    }
  })
})

describe('copyWithFeedback', () => {
  it('goes copied then idle after 2 s; failed on a rejected copy', async () => {
    vi.useFakeTimers()
    const seen: CopyState[] = []
    await copyWithFeedback(
      'x',
      (s) => seen.push(s),
      () => Promise.resolve(true),
    )
    expect(seen).toEqual(['copied'])
    vi.advanceTimersByTime(1999)
    expect(seen).toEqual(['copied'])
    vi.advanceTimersByTime(1)
    expect(seen).toEqual(['copied', 'idle'])
    await copyWithFeedback(
      'x',
      (s) => seen.push(s),
      () => Promise.reject(new Error('no')),
    )
    expect(seen.at(-1)).toBe('failed')
    vi.advanceTimersByTime(2000)
    expect(seen.at(-1)).toBe('idle')
    vi.useRealTimers()
  })
})
