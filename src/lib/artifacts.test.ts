import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ARTIFACT_MAX_BYTES, readArtifactFile } from './artifact-read.ts'
import {
  artifactGroups,
  beadArtifacts,
  parseArtifacts,
  parseExternalRef,
} from './artifacts.ts'
import { parseArtifactInput } from './server-validation.ts'

import type { Bead } from './types.ts'

describe('readArtifactFile confinement', () => {
  const base = mkdtempSync(join(tmpdir(), 'bd-art-'))
  const root = join(base, 'proj')
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'docs', 'a.md'), '# hi')
  writeFileSync(join(root, 'docs', 'p.png'), Buffer.from([1, 2, 3]))
  writeFileSync(join(root, 'docs', 'run.sh'), 'echo')
  writeFileSync(
    join(root, 'docs', 'big.txt'),
    Buffer.alloc(ARTIFACT_MAX_BYTES + 1),
  )
  writeFileSync(join(base, 'secret.md'), 'secret')
  writeFileSync(join(base, 'secret.sh'), 'secret')
  symlinkSync(join(base, 'secret.md'), join(root, 'docs', 'link.md'))
  symlinkSync(base, join(root, 'outdir'))
  symlinkSync(join(root, 'docs', 'run.sh'), join(root, 'docs', 'alias.md'))

  it('reads a markdown file and an image as data URL', async () => {
    const md = await readArtifactFile(root, 'docs/a.md')
    expect(md).toMatchObject({ kind: 'markdown', content: '# hi', bytes: 4 })
    const png = await readArtifactFile(root, './docs/p.png')
    expect(png.content).toBe('data:image/png;base64,AQID')
  })

  it.each([
    ['parent traversal', '../secret.md', /escapes|not found/],
    ['deep traversal', 'docs/../../secret.md', /escapes/],
    ['absolute path', join(base, 'secret.md'), /relative/],
    ['symlinked file out of root', 'docs/link.md', /escapes/],
    ['symlinked dir out of root', 'outdir/secret.md', /escapes/],
    ['bad extension', 'docs/run.sh', /not allowed/],
    ['symlink hiding bad extension', 'docs/alias.md', /not allowed/],
    ['oversize', 'docs/big.txt', /larger than 2 MB/],
    ['missing', 'docs/none.md', /not found/],
    ['empty', '', /Invalid/],
  ])('refuses %s', async (_name, p, msg) => {
    await expect(readArtifactFile(root, p)).rejects.toThrow(msg)
  })
})

describe('artifact metadata parsing', () => {
  it('parses a JSON string and defaults the label', () => {
    const m = {
      artifacts: '[{"path":"a.md"},{"path":"b.html","label":"B","stage":"qa"}]',
    }
    expect(parseArtifacts(m)).toEqual([
      { path: 'a.md', label: 'a.md', stage: undefined },
      { path: 'b.html', label: 'B', stage: 'qa' },
    ])
  })

  it.each([
    undefined,
    null,
    {},
    { artifacts: '{not json' },
    { artifacts: '"str"' },
    { artifacts: 5 },
    { artifacts: [null, 3, { label: 'no path' }, { path: 7 }] },
  ])('never throws on bad input %j', (m) => {
    expect(parseArtifacts(m)).toEqual([])
  })

  it('puts spec_id first as "Spec"', () => {
    const list = beadArtifacts({
      spec_id: 'docs/s.md',
      metadata: { artifacts: '[{"path":"x.png"}]' },
    })
    expect(list.map((a) => a.label)).toEqual(['Spec', 'x.png'])
  })

  it('groups children for an epic', () => {
    const epic = {
      id: 'e',
      spec_id: 'e.md',
      childBeads: [
        {
          id: 'c1',
          title: 'one',
          metadata: { artifacts: '[{"path":"a.md"}]' },
        },
        { id: 'c2', title: 'none' },
      ],
    } as unknown as Bead
    const groups = artifactGroups(epic)
    expect(groups.map((g) => g.child?.id)).toEqual([undefined, 'c1'])
  })
})

describe('parseExternalRef', () => {
  it('links http(s) URLs', () => {
    expect(parseExternalRef('https://github.com/o/r/issues/9')).toEqual({
      kind: 'link',
      href: 'https://github.com/o/r/issues/9',
    })
  })
  it('keeps non-URLs as text, never a link', () => {
    expect(parseExternalRef('gh-9')).toEqual({ kind: 'text', text: 'gh-9' })
    expect(parseExternalRef('javascript:alert(1)')).toEqual({
      kind: 'text',
      text: 'javascript:alert(1)',
    })
  })
  it('returns null for empty', () => {
    expect(parseExternalRef('')).toBeNull()
    expect(parseExternalRef('  ')).toBeNull()
    expect(parseExternalRef(undefined)).toBeNull()
  })
})

describe('parseArtifactInput', () => {
  it('validates project and path', () => {
    expect(parseArtifactInput({ project: 'p1', path: ' a/b.md ' })).toEqual({
      project: 'p1',
      path: 'a/b.md',
    })
    expect(() => parseArtifactInput({ project: 'p1' })).toThrow()
    expect(() =>
      parseArtifactInput({ project: '../x', path: 'a.md' }),
    ).toThrow()
  })
})
