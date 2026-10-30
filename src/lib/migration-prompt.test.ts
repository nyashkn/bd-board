import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { copyWithFeedback } from './copy-text.ts'
import type { CopyState } from './copy-text.ts'
import {
  buildMigrationPrompt,
  MIGRATION_OPTIONS,
  pathProblem,
  shQuote,
} from './migration-prompt.ts'
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
    expect(p).toContain('Project path: `/work/ledger`')
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
      'bd export -o ~/beads-backup-led.jsonl',
      '430 ms -> 89 ms',
      '4.3 s -> 0.13 s',
      'Never use `--force`, `--reinit-local` or `--discard-remote`',
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

describe('prompt safety', () => {
  const blocks = (p: string) =>
    [...p.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1].split('\n'))

  it.each(options)(
    '%s: every shell block cd-s first; mv and export are guarded',
    (o) => {
      const p = buildMigrationPrompt({ ...ctx, path: "/w/it's here" }, o)
      const cd = "cd '/w/it'\\''s here' || exit 1"
      for (const lines of blocks(p)) {
        expect(lines[0]).toBe(cd)
        lines.forEach((l, n) => {
          if (/^(mv |bd export -o )/.test(l)) {
            expect(lines[n - 1]).toMatch(
              /^test ! -e .* \|\| \{ echo "target exists"; exit 1; \}$/,
            )
          }
        })
      }
    },
  )

  it('uses per-project names and keeps rollback to the options that move .beads', () => {
    const a = buildMigrationPrompt(ctx, 'shared-server')
    expect(a).toContain('../led-beads-embedded')
    expect(a).not.toMatch(/~\/beads-backup\.jsonl|\.\.\/beads-embedded/)
    expect(a).toContain('## Rollback')
    expect(buildMigrationPrompt(ctx, 'remote-server')).toContain('## Rollback')
    const b = buildMigrationPrompt(ctx, 'bucket-remote')
    expect(b).not.toContain('mv ')
    expect(b.match(/## Rollback/g)).toBeNull()
    expect(b).toContain('Rollback: stop bd')
  })

  it('stops on a redirected workspace', () => {
    expect(buildMigrationPrompt(ctx, 'shared-server')).toContain(
      'STOP and report if `bd where` does not show the workspace as `/work/ledger/.beads`',
    )
  })

  it('validates prefix and version, quotes paths, flags control characters', () => {
    const p = buildMigrationPrompt(
      {
        path: '/x',
        prefix: 'a b; rm -rf ~',
        mode: 'embedded',
        bdVersion: '1.3.2; x',
      },
      'shared-server',
    )
    expect(p).toContain('-p <prefix>')
    expect(p).toContain('bd version: unknown')
    expect(p).not.toContain('rm -rf')
    expect(shQuote("a'b")).toBe("'a'\\''b'")
    expect(pathProblem('/ok/path')).toBeNull()
    expect(pathProblem('/a\nb')).not.toBeNull()
    expect(pathProblem('/a\u0007b')).not.toBeNull()
  })
})

// bd 1.3.2 help output, checked in as fixtures (`bd <cmd> --help`).
const help = (name: string) =>
  readFileSync(
    new URL(`./fixtures/bd-help/${name}.txt`, import.meta.url),
    'utf8',
  )

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A whole flag token, so `--server` is not satisfied by `--server-host`. */
const hasFlag = (text: string, flag: string) =>
  new RegExp('(^|[\\s,])' + escapeRe(flag) + '(?=[\\s,=]|$)', 'm').test(text)

/** Every `bd ...` command the prompt shows: fenced lines and inline code (prose included). */
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
  const unknown = bdCommands(
    buildMigrationPrompt({ path: '/x', mode: 'unknown' }, 'shared-server'),
  )

  it('finds the commands, prose ones included', () => {
    expect(all).toContain(
      'bd init -p led --shared-server --non-interactive --skip-agents --skip-hooks',
    )
    expect(unknown).toContain('bd config get issue_prefix')
    expect(unknown).toContain('bd --version')
    expect(all.length).toBeGreaterThan(15)
  })

  it('hasFlag matches whole tokens only (negative proof)', () => {
    const init = help('init')
    expect(hasFlag(init, '--server')).toBe(true)
    const without = init.replace(/--server(?![\w-])/g, '')
    expect(without).toContain('--server-host')
    expect(hasFlag(without, '--server')).toBe(false)
    expect(hasFlag(without, '--server-host')).toBe(true)
  })

  it.each([...new Set([...all, ...unknown])])('%s', (cmd) => {
    const [, sub, ...rest] = cmd.split(' | ')[0].split(/\s+/)
    // Top-level subcommand: a row in `bd --help`.
    if (!sub.startsWith('-'))
      expect(root).toMatch(new RegExp(`^ {2}${sub}\\s`, 'm'))
    else expect(hasFlag(root, sub)).toBe(true)
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
      expect(hasFlag(text, flag), `${flag} in bd ${sub} --help`).toBe(true)
    }
  })
})

describe('copyWithFeedback', () => {
  it('goes copied then idle after 2 s; failed on a rejected copy; a repeat restarts the timer', async () => {
    vi.useFakeTimers()
    const seen: CopyState[] = []
    const timer = {}
    const set = (s: CopyState) => seen.push(s)
    await copyWithFeedback('x', set, timer, () => Promise.resolve(true))
    expect(seen).toEqual(['copied'])
    vi.advanceTimersByTime(1500)
    await copyWithFeedback('x', set, timer, () => Promise.resolve(true))
    vi.advanceTimersByTime(1999)
    expect(seen).toEqual(['copied', 'copied'])
    vi.advanceTimersByTime(1)
    expect(seen).toEqual(['copied', 'copied', 'idle'])
    await copyWithFeedback('x', set, timer, () =>
      Promise.reject(new Error('no')),
    )
    expect(seen.at(-1)).toBe('failed')
    vi.advanceTimersByTime(2000)
    expect(seen.at(-1)).toBe('idle')
    vi.useRealTimers()
  })
})
