import { describe, expect, it } from 'vitest'

import { buildQuery, chipOf, commitChips, isEmptyQuery } from './palette-query'
import { MAX_RECENT, parseRecent, pushRecent } from './palette-recent'
import {
  buildDocs,
  indexComments,
  makeSnippet,
  matchText,
  mergeRanges,
  searchDocs,
} from './palette-search'

import type { RecentEntry } from './palette-recent'
import type { Bead } from './types'

const bead = (id: string, over: Partial<Bead> = {}): Bead => ({
  id,
  title: id,
  status: 'open',
  priority: 2,
  issue_type: 'task',
  updated_at: '2026-06-01T00:00:00Z',
  ...over,
})

const BEADS: Bead[] = [
  bead('p-1', { title: 'Epic: Payments', issue_type: 'epic' }),
  bead('p-2', {
    title: 'Refund flow',
    parent: 'p-1',
    labels: ['billing'],
    assignee: 'ana',
    description: 'Handle the zebra edge case when the card is declined.',
  }),
  bead('p-3', { title: 'Zebra stripes', parent: 'p-1' }),
  bead('p-4', {
    title: 'Closed zebra thing',
    status: 'closed',
    updated_at: '2026-07-01T00:00:00Z',
  }),
  bead('p-5', {
    title: 'Docs',
    metadata: {
      artifacts: JSON.stringify([
        { path: 'docs/spec-quokka.md', label: 'Spec' },
      ]),
    },
  }),
  bead('p-12', { title: 'Twelve' }),
]
const docs = buildDocs({ id: 'p', name: 'Proj' }, BEADS)
const ids = (q: string, opts = {}) =>
  searchDocs(docs, buildQuery([], q), opts).map((h) => h.doc.bead.id)

describe('query: chips', () => {
  it.each([
    ['status:open', { kind: 'status', value: 'open' }],
    ['EPIC:pay', { kind: 'epic', value: 'pay' }],
    ['label:wo', { kind: 'label', value: 'wo' }],
    ['type:bug', { kind: 'type', value: 'bug' }],
    ['@ana', { kind: 'assignee', value: 'ana' }],
    ['status:', null],
    ['@', null],
    [':x', null],
    ['foo:bar', null],
    ['a@b.com', null],
  ])('chipOf(%s)', (token, chip) => {
    expect(chipOf(token)).toEqual(chip)
  })

  it('commits only finished tokens', () => {
    expect(commitChips('status:open ')).toEqual({
      chips: [{ kind: 'status', value: 'open' }],
      rest: '',
    })
    expect(commitChips('status:op')).toEqual({ chips: [], rest: 'status:op' })
    expect(commitChips('foo @ana bar')).toEqual({
      chips: [{ kind: 'assignee', value: 'ana' }],
      rest: 'foo bar',
    })
  })

  it('treats a chip being typed as a live filter, not as a word', () => {
    const q = buildQuery([], 'refund status:op')
    expect(q.words).toEqual(['refund'])
    expect(q.chips).toEqual([{ kind: 'status', value: 'op' }])
  })

  it('handles empty, whitespace, very long and regex-special input', () => {
    expect(isEmptyQuery(buildQuery([], ''))).toBe(true)
    expect(isEmptyQuery(buildQuery([], '   '))).toBe(true)
    expect(buildQuery([], 'a'.repeat(5000)).words[0]).toHaveLength(200)
    expect(buildQuery([], '1 2 3 4 5 6 7 8 9 10').words).toHaveLength(8)
    expect(buildQuery([], '.*+?^${}()|[]\\').words).toEqual(['.*+?^${}()|[]\\'])
  })
})

describe('matchText', () => {
  it('prefers prefix over word start over inside a word', () => {
    expect(matchText('refund flow', 'ref')?.kind).toBe('prefix')
    expect(matchText('a refund', 'ref')?.kind).toBe('word')
    expect(matchText('prefund', 'ref')?.kind).toBe('sub')
  })

  it('finds a later word-start match over an earlier mid-word one', () => {
    expect(matchText('xrefund ref', 'ref')).toEqual({
      kind: 'word',
      ranges: [{ start: 8, end: 11 }],
    })
  })

  it('does fuzzy subsequence only when asked, tight and for 3+ chars', () => {
    expect(matchText('refund flow', 'rfd')).toBeNull()
    expect(matchText('refund flow', 'rfd', true)?.kind).toBe('fuzzy')
    expect(matchText('refund flow', 'rf', true)).toBeNull()
    expect(matchText('r' + 'x'.repeat(40) + 'fd', 'rfd', true)).toBeNull()
  })

  it('never treats the query as a regex', () => {
    expect(matchText('price (usd) .* done', '.*')?.ranges).toEqual([
      { start: 12, end: 14 },
    ])
    expect(matchText('abc', '[')).toBeNull()
    expect(matchText('', 'a')).toBeNull()
    expect(matchText('abc', '')).toBeNull()
  })

  it('merges ranges', () => {
    expect(
      mergeRanges([
        { start: 4, end: 6 },
        { start: 0, end: 2 },
        { start: 2, end: 3 },
      ]),
    ).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 6 },
    ])
  })
})

describe('makeSnippet edges', () => {
  const long = 'word '.repeat(100) + 'NEEDLE ' + 'word '.repeat(100)
  const at = long.indexOf('NEEDLE')

  it('windows around a mid-text match with ellipses and shifted ranges', () => {
    const s = makeSnippet(long, [{ start: at, end: at + 6 }])
    expect(s.text.startsWith('…')).toBe(true)
    expect(s.text.endsWith('…')).toBe(true)
    expect(s.text.length).toBeLessThan(120)
    const r = s.ranges[0]
    expect(s.text.slice(r.start, r.end)).toBe('NEEDLE')
  })

  it('has no leading ellipsis at the start and no trailing one at the end', () => {
    const start = makeSnippet('hello world', [{ start: 0, end: 5 }])
    expect(start).toEqual({
      text: 'hello world',
      ranges: [{ start: 0, end: 5 }],
    })
    const tail = makeSnippet('x '.repeat(100) + 'end', [
      { start: 200, end: 203 },
    ])
    expect(tail.text.endsWith('…')).toBe(false)
    expect(tail.text.endsWith('end')).toBe(true)
  })

  it('copes with empty text and no ranges', () => {
    expect(makeSnippet('', [])).toEqual({ text: '', ranges: [] })
    expect(makeSnippet('abc', []).ranges).toEqual([])
  })
})

describe('ranking table', () => {
  it.each([
    ['exact id first', 'p-1', ['p-1', 'p-12']],
    ['id prefix beats a later part', 'p-1', ['p-1', 'p-12']],
    ['title prefix over title word', 'zebra', ['p-3', 'p-2', 'p-4']],
    ['labels/assignee over description', 'billing', ['p-2']],
    ['assignee match', 'ana', ['p-2']],
    ['description only', 'declined', ['p-2']],
    ['artifact path', 'quokka', ['p-5']],
    ['all words must match', 'refund declined', ['p-2']],
    ['no match', 'nonexistent', []],
  ])('%s: %s', (_name, q, expected) => {
    expect(ids(q)).toEqual(expected)
  })

  it('puts title hits above description hits and closed beads last', () => {
    // p-3 (title prefix) > p-2 (description) > p-4 (title word, but closed)
    expect(ids('zebra')).toEqual(['p-3', 'p-2', 'p-4'])
  })

  it('ranks title above labels above description above comments', () => {
    const mk = (id: string, over: Partial<Bead>) => bead(id, over)
    const d = buildDocs({ id: 'p', name: 'P' }, [
      mk('d', { title: 'x', description: 'foo here' }),
      mk('l', { title: 'x', labels: ['foo'] }),
      mk('t', { title: 'a foo' }),
      mk('c', { title: 'x' }),
    ])
    const comments = indexComments('p', [{ bead_id: 'c', text: 'foo said' }])
    const out = searchDocs(d, buildQuery([], 'foo'), { comments }).map(
      (h) => h.doc.bead.id,
    )
    expect(out).toEqual(['t', 'l', 'd', 'c'])
  })

  it('shows a snippet only for non-title hits, with highlight ranges', () => {
    const [desc] = searchDocs(docs, buildQuery([], 'declined'))
    expect(desc.snippet?.kind).toBe('description')
    const r = desc.snippet!.ranges[0]
    expect(desc.snippet!.text.slice(r.start, r.end)).toBe('declined')
    const [title] = searchDocs(docs, buildQuery([], 'stripes'))
    expect(title.snippet).toBeUndefined()
    expect(title.titleRanges).toEqual([{ start: 6, end: 13 }])
  })

  it('falls back to fuzzy title matching below substring hits', () => {
    expect(ids('rfnd')).toEqual(['p-2'])
  })

  it('survives very long and regex-special queries', () => {
    expect(ids('a'.repeat(5000))).toEqual([])
    expect(ids('(.*[')).toEqual([])
    expect(ids('')).toEqual([])
  })
})

describe('chips narrow results', () => {
  const run = (chips: string, q = '') =>
    searchDocs(docs, buildQuery(commitChips(chips + ' ').chips, q)).map(
      (h) => h.doc.bead.id,
    )

  it('status, type, label, assignee, epic', () => {
    expect(run('status:closed')).toEqual(['p-4'])
    expect(run('type:epic')).toEqual(['p-1'])
    expect(run('label:bill')).toEqual(['p-2'])
    expect(run('@an')).toEqual(['p-2'])
    expect(new Set(run('epic:payments'))).toEqual(
      new Set(['p-1', 'p-2', 'p-3']),
    )
  })

  it('combines chips with words and ANDs them', () => {
    expect(run('status:open', 'zebra')).toEqual(['p-3', 'p-2'])
    expect(run('status:open @ana', 'zebra')).toEqual(['p-2'])
  })
})

describe('recent list', () => {
  const e = (n: number): RecentEntry => ({ project: 'p', id: `b${n}` })

  it('puts the newest first, dedupes and caps', () => {
    let list: RecentEntry[] = []
    for (let i = 0; i < 12; i++) list = pushRecent(list, e(i))
    expect(list).toHaveLength(MAX_RECENT)
    expect(list[0]).toEqual(e(11))
    list = pushRecent(list, e(5))
    expect(list[0]).toEqual(e(5))
    expect(list.filter((x) => x.id === 'b5')).toHaveLength(1)
  })

  it('parses hostile storage defensively', () => {
    expect(parseRecent(null)).toEqual([])
    expect(parseRecent('not json')).toEqual([])
    expect(parseRecent('{"a":1}')).toEqual([])
    expect(
      parseRecent('[null, 3, {"project":"p"}, {"project":"p","id":"x"}]'),
    ).toEqual([{ project: 'p', id: 'x' }])
  })
})

describe('pinning, late group, is:/project: chips', () => {
  const d = buildDocs({ id: 'p', name: 'Proj' }, [
    bead('p-9', { title: 'Old thing', status: 'closed' }),
    bead('p-90', { title: 'Newer p-9 mention', ready: false }),
    bead('p-7', {
      title: 'Mine',
      assignee: 'Ana',
      waiting_on: ['p-9'],
      ready: false,
    }),
    bead('p-8', {
      title: 'Ready one',
      ready: true,
      updated_at: '2026-08-01T00:00:00Z',
    }),
  ])

  it('keeps an exact id on top even when the bead is closed', () => {
    const out = searchDocs(d, buildQuery([], 'p-9')).map((h) => h.doc.bead.id)
    expect(out[0]).toBe('p-9')
  })

  it('puts comment-only hits in a separate group, leaving main rows alone', () => {
    const comments = indexComments('p', [{ bead_id: 'p-7', text: 'gnu note' }])
    const hits = searchDocs(d, buildQuery([], 'gnu'), { comments })
    expect(hits.map((h) => [h.doc.bead.id, h.late])).toEqual([['p-7', true]])
    const keys = (c?: typeof comments) =>
      searchDocs(d, buildQuery([], 'ready'), { comments: c }).map(
        (h) => h.doc.key,
      )
    expect(keys()).toEqual(keys(comments))
  })

  it('parses is:, mine, @me and project: chips', () => {
    expect(chipOf('is:mine')).toEqual({ kind: 'is', value: 'mine' })
    expect(chipOf('mine')).toEqual({ kind: 'is', value: 'mine' })
    expect(chipOf('@me')).toEqual({ kind: 'is', value: 'mine' })
    expect(chipOf('is:bogus')).toBeNull()
    expect(chipOf('project:web')).toEqual({ kind: 'project', value: 'web' })
  })

  const run = (token: string, opts = {}) =>
    searchDocs(d, buildQuery(commitChips(`${token} `).chips, ''), opts).map(
      (h) => h.doc.bead.id,
    )

  it('applies is:mine, is:ready, is:blocked, is:since and project:', () => {
    expect(run('is:mine', { me: 'ana' })).toEqual(['p-7'])
    expect(run('is:mine')).toEqual([])
    expect(run('is:ready')).toEqual(['p-8'])
    expect(run('is:blocked')).toEqual(['p-7'])
    const since = { project: 'p', at: Date.parse('2026-07-15T00:00:00Z') }
    expect(run('is:since', { since })).toEqual(['p-8'])
    expect(run('is:since')).toEqual([])
    expect(run('project:proj')).toHaveLength(4)
    expect(run('project:zzz')).toEqual([])
  })
})
