/**
 * Cmd+K search correctness matrix (MECE). One test per cell; the cell id leads the test name.
 * Same matrix, with prose: bd-board-ux-review/search-test-matrix.md.
 *
 * Engine facts the matrix pins down (read from palette-query.ts / palette-search.ts):
 *  - Free words: lower-cased, AND-ed, order-independent; a hit's score = its WEAKEST word.
 *  - Per word, best field wins: id (exact 1000 / prefix 850 / part 650), title (prefix 800 / word 640 /
 *    sub 600 / fuzzy 500), label+assignee (420 prefix / 400), description (310 word / 300), comment 200,
 *    artifact 180. Comment/artifact-only hits are `late` (own group, after the main rows).
 *  - Fuzzy (in-order subsequence, span <= 2x length, 3+ chars) applies to the TITLE only.
 *  - Typo tolerance (behaviour decision, ClickUp-like): letters-only words of 5+ chars tolerate 1 edit, 8+ tolerate 2
 *    (insert/delete/substitute/adjacent swap) against whole tokens of title, description, labels, assignee. Never ids,
 *    chip values, comments or artifacts. Scores sit below every real match (title 290, meta 280, description 270).
 *  - Diacritics and case are folded (behaviour decision, see fold()).
 *  - Parent-epic title is reachable only through the `epic:` chip, never as a free word.
 *  - Closed beads sort after open ones, except an exact id. No 7-day window exists in the engine.
 *  - Scope is always "all projects"; narrowing is the `project:` chip. Read-only is a data-source flag, not engine.
 *
 * A  FIELD            A1 id exact · A2 id prefix · A3 id substring · A4 title · A5 description · A6 labels
 *                     A7 assignee · A8 comment · A9 artifact path · A10 parent epic title · A11 none
 * B  MATCH TYPE       B1 exact · B2 prefix · B3 word-boundary · B4 substring · B5 fuzzy(subsequence, title only)
 *                     B6 typo: B6a substitution/insertion/deletion · B6b transposition · B6c too short · B6d id never · B6e chip value never ·
 *                     B6f ranks below real matches · B6g deterministic · B6h accent+typo · B6i highlight = the typo'd token · B7 case fold · B8 diacritic fold · B9 multi-word AND, any order
 *                     B10 regex-special · B11 unicode/emoji · B12 very long · B13 empty/whitespace
 * C  CHIPS            C1 status: · C2 type: · C3 label: · C4 epic: · C5 project: · C6 @name · C7 mine · C8 is:ready
 *                     C9 is:blocked · C10 is:since · C11 combined (AND) · C12 chip without value · C13 unknown key
 *                     C14 duplicate · C15 chip + free text
 * D  BEAD STATE       D1 open · D2 in_progress · D3 blocked · D4 deferred · D5 closed (always included, no window)
 *                     D6 epic · D7 task · D8 molecule · D9 bead with no description/labels/assignee/parent
 * E  RANK / GROUP     E1 exact id pinned even if closed · E2 title prefix > title word > sub · E3 title > labels
 *                     E4 labels/assignee > description · E5 description > comment · E6 closed last
 *                     E7 late group for comment/artifact · E8 stable order on ties · E9 main cap · E10 late cap
 *                     E11 highlight ranges (multi-word, overlap) · E12 snippet bounds (start/end/middle)
 * F  CROSS-PROJECT    F1 same text two projects · F2 project: chip · F3 all-scope default · F4 read-only parity · F5 scope pill current vs all · F6 project: chip overrides scope · F7 scope default/persist (e2e)
 * G  INDEX TIMING     G1 before comments · G2 after (late fills, main rows fixed) · G3 failed bead/project
 * P  PROPERTIES       P1 deterministic · P2 never throws · P3 hit contains terms · P4 chip never adds
 */
import { describe, expect, it } from 'vitest'

import { buildQuery, fold, scopeCycle } from './palette-query'
import {
  buildDocs,
  DEFAULT_LIMIT,
  editDistance,
  indexComments,
  LATE_LIMIT,
  makeSnippet,
  searchDocs,
} from './palette-search'

import type { SearchOptions } from './palette-search'
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

const ALPHA: Bead[] = [
  bead('a-1', { title: 'Payments overhaul', issue_type: 'epic' }),
  bead('a-2', {
    title: 'Refund flow',
    parent: 'a-1',
    labels: ['billing', 'Urgent'],
    assignee: 'Ana Mwangi',
    description:
      'Handle the zebra edge case when the card is declined. Café owners too.',
  }),
  bead('a-3', { title: 'Zebra stripes', parent: 'a-1', status: 'in_progress' }),
  bead('a-4', {
    title: 'Closed zebra thing',
    status: 'closed',
    updated_at: '2026-07-01T00:00:00Z',
  }),
  bead('a-5', {
    title: 'Docs',
    metadata: {
      artifacts: JSON.stringify([
        { path: 'docs/spec-quokka.md', label: 'Spec' },
      ]),
    },
  }),
  bead('a-6', { title: 'Blocked widget', status: 'blocked' }),
  bead('a-7', { title: 'Deferred gadget', status: 'deferred' }),
  bead('a-8', { title: 'Mol thing', issue_type: 'molecule' }),
  bead('a-9', { title: 'Bare' }),
  bead('a-12', { title: 'Twelve' }),
  bead('a-10', { title: 'Résumé parser' }),
  bead('a-11', { title: 'C++ [x] (y) $^.*+?|\\ 🚀 done' }),
  bead('a-13', { title: 'Waiting', waiting_on: ['a-6'] }),
]
const BETA: Bead[] = [
  bead('b-1', { title: 'Zebra stripes', labels: ['billing'] }),
]

const proj = (id: string, name: string, beads: Bead[]) =>
  buildDocs({ id, name }, beads)
const ALL = [...proj('alpha', 'Alpha', ALPHA), ...proj('beta', 'Beta', BETA)]

const run = (
  q: string,
  opts: SearchOptions = {},
  docs = ALL,
  chips: never[] = [],
) => searchDocs(docs, buildQuery(chips, q), opts)
const ids = (q: string, opts: SearchOptions = {}, docs = ALL) =>
  run(q, opts, docs).map((h) => h.doc.bead.id)

type Row = [cell: string, query: string, expected: string[]]
const table = (rows: Row[], opts: SearchOptions = {}) =>
  it.each(rows)('%s · %s', (_c, q, expected) => {
    expect(ids(q, opts)).toEqual(expected)
  })

describe('A·B field × match type', () => {
  table([
    ['A1·B1 id exact', 'a-2', ['a-2']],
    ['A2·B2 id prefix', 'a-1', ['a-1', 'a-10', 'a-11', 'a-12', 'a-13']],
    ['A3·B4 id substring', '-12', ['a-12']],
    ['A4·B2 title prefix', 'refund', ['a-2']],
    ['A4·B3 title word-boundary', 'flow', ['a-2']],
    ['A4·B4 title substring', 'ebra', ['a-3', 'b-1', 'a-2', 'a-4']],
    ['A4·B5 title fuzzy subsequence', 'rfnd', ['a-2']],
    ['A5·B3 description word-boundary', 'declined', ['a-2']],
    ['A5·B4 description substring', 'eclin', ['a-2']],
    ['A6·B2 label prefix', 'bill', ['a-2', 'b-1']],
    ['A7·B3 assignee word', 'mwangi', ['a-2']],
    ['A8·B2 comment (needs index)', 'chargeback', []],
    ['A9·B3 artifact path word', 'quokka', ['a-5']],
    ['A10·B2 parent epic title is NOT a free word', 'overhaul', ['a-1']],
    ['A11·B1 none', 'qqqq', []],
  ])
  table([['B5 fuzzy is title-only (description does not fuzz)', 'zbrcrd', []]])
  table([['B7 case fold query', 'REFUND', ['a-2']]])
  table([['B7 case fold label', 'urgent', ['a-2']]])
  // behaviour decision: ClickUp folds accents both ways, so "cafe" finds "Café" and "resume" finds "Résumé".
  table([['B8 diacritic fold (hay accented)', 'resume', ['a-10']]])
  table([['B8 diacritic fold (description)', 'cafe', ['a-2']]])
  table([['B8 diacritic fold (query accented)', 'résumé', ['a-10']]])
  table([
    ['B9 multi-word AND', 'zebra stripes', ['a-3', 'b-1']],
    ['B9 multi-word any order', 'stripes zebra', ['a-3', 'b-1']],
    ['B9 multi-word across fields', 'refund zebra', ['a-2']],
    ['B9 multi-word one word missing', 'refund qqqq', []],
    ['B10 regex special inert', '.*', ['a-11']],
    ['B10 regex special bracket', '[x]', ['a-11']],
    ['B10 lone backslash', '\\', ['a-11']],
    ['B11 emoji', '🚀', ['a-11']],
    ['B13 empty', '', []],
    ['B13 whitespace only', '   \t ', []],
  ])
  it('B12 very long query: truncated, no throw, no hit', () => {
    expect(ids('z'.repeat(100_000))).toEqual([])
  })
  it('B9 a ninth word is ignored (cap 8 words)', () => {
    expect(buildQuery([], 'a b c d e f g h i').words).toHaveLength(8)
  })
})

describe('B6 typo tolerance', () => {
  const T = proj('t', 'T', [
    bead('t-1', {
      title: 'Pangolin tracker',
      description: 'Counting armadillos nightly',
      labels: ['mammals'],
      assignee: 'Wanjiru',
    }),
    bead('t-2', { title: 'Résumé parser' }),
    bead('t-3', { title: 'Spec', description: 'pangolin appears here' }),
    bead('t-4', { title: 'Frontend' }),
  ])
  const tids = (q: string) => ids(q, {}, T)
  it('B6a substitution', () => expect(tids('pangolen')).toEqual(['t-1', 't-3']))
  it('B6a insertion', () => expect(tids('pangolinn')).toEqual(['t-1', 't-3']))
  it('B6a deletion', () => expect(tids('pangoln')).toEqual(['t-1', 't-3']))
  it('B6b adjacent transposition', () =>
    expect(tids('pnagolin')).toEqual(['t-1', 't-3']))
  it('B6a 8+ letters tolerate 2 edits, 5-7 only 1', () => {
    expect(tids('pnagoiln')).toEqual(['t-1', 't-3'])
    expect(tids('pngolen')).toEqual([])
  })
  it('B6a typo in description, label and assignee', () => {
    expect(tids('armadilos')).toEqual(['t-1'])
    expect(tids('mamals')).toEqual(['t-1'])
    expect(tids('wanjru')).toEqual(['t-1'])
  })
  it('B6c too-short words get no tolerance (4 letters)', () => {
    expect(tids('spce')).toEqual([])
    expect(tids('hree')).toEqual([])
  })
  it('B6d ids are never fuzzy', () => {
    expect(ids('a-3x')).toEqual([])
    expect(ids('alphaa-3')).toEqual([])
  })
  it('B6e chip values are never fuzzy', () => {
    expect(ids('label:billng')).toEqual([])
    expect(ids('status:opne')).toEqual([])
    expect(ids('project:alpah')).toEqual([])
  })
  it('B6f typo ranks below exact/prefix/word/substring hits', () => {
    const d = proj('r', 'R', [
      bead('r-1', { title: 'Pangoln typo' }),
      bead('r-2', { title: 'xpangolin sub' }),
      bead('r-3', { title: 'Pangolin prefix' }),
      bead('r-4', { title: 'a pangolin word' }),
      bead('r-5', { title: 'n', description: 'pangolin in description' }),
    ])
    expect(ids('pangolin', {}, d)).toEqual(['r-3', 'r-4', 'r-2', 'r-5', 'r-1'])
  })
  it('B6g deterministic', () => {
    expect(tids('pangoln')).toEqual(tids('pangoln'))
    expect(run('pangoln', {}, T)).toEqual(run('pangoln', {}, [...T].reverse()))
  })
  it('B6h accent + typo together', () => {
    expect(tids('resumee')).toEqual(['t-2'])
    expect(tids('rseume')).toEqual(['t-2'])
  })
  it('B6i highlight covers the typo’d token, not a wrong span', () => {
    const [h] = run('pnagolin', {}, T)
    expect(h.titleRanges).toEqual([{ start: 0, end: 8 }])
    const d = run('armadilos', {}, T)[0].snippet!
    expect(d.text.slice(d.ranges[0].start, d.ranges[0].end)).toBe('armadillos')
  })
  it('B6 editDistance basics', () => {
    expect(editDistance('ab', 'ba', 1)).toBe(1)
    expect(editDistance('kitten', 'sitting', 3)).toBe(3)
    expect(editDistance('abc', 'xyz', 1)).toBeGreaterThan(1)
  })
  it('B6 perf: 5,000 beads per keystroke', () => {
    const words = [
      'alpha',
      'invoice',
      'payment',
      'refund',
      'checkout',
      'webhook',
      'retry',
      'schema',
      'cache',
      'queue',
    ]
    const big = proj(
      'big',
      'Big',
      Array.from({ length: 5000 }, (_, i) =>
        bead(`g-${i}`, {
          title: `${words[i % 10]} ${words[(i * 7) % 10]} item ${i}`,
          description: Array.from(
            { length: 30 },
            (_, j) => words[(i + j * 3) % 10],
          ).join(' '),
          labels: [words[i % 10]],
          assignee: 'person' + (i % 7),
        }),
      ),
    )
    const times: number[] = []
    for (const q of [
      'pangoln',
      'chekout',
      'refnd paymnet',
      'webhok',
      'qeueu',
    ]) {
      let best = Infinity // best of 7: a keystroke's cost without scheduler noise
      for (let n = 0; n < 7; n++) {
        const t0 = performance.now()
        run(q, {}, big)
        best = Math.min(best, performance.now() - t0)
      }
      times.push(best)
    }
    console.log(
      'typo search ms per keystroke over 5000 beads:',
      times.map((x) => x.toFixed(1)).join(' '),
    )
    expect(Math.max(...times)).toBeLessThan(30)
  })
})

describe('C chips', () => {
  const sorted = (q: string, opts: SearchOptions = {}) => ids(q, opts).sort()
  it('C1 status:open (deferred and waiting beads included by raw status/column)', () => {
    const r = sorted('status:open')
    expect(r).toContain('a-7')
    expect(r).not.toContain('a-3')
    expect(r).not.toContain('a-4')
  })
  it('C1 status:in-progress, prefix and dash', () => {
    expect(ids('status:in-prog')).toEqual(['a-3'])
  })
  it('C1 status:closed', () => expect(ids('status:closed')).toEqual(['a-4']))
  it('C2 type:epic / molecule / prefix', () => {
    expect(ids('type:epic')).toEqual(['a-1'])
    expect(ids('type:mol')).toEqual(['a-8'])
  })
  it('C3 label:bill (prefix, case-insensitive)', () => {
    expect(sorted('label:BILL')).toEqual(['a-2', 'b-1'])
    expect(sorted('label:ill')).toEqual([]) // prefix, not substring
  })
  it('C4 epic: by title or id, epic itself included', () => {
    expect(sorted('epic:payments')).toEqual(['a-1', 'a-2', 'a-3'])
    expect(sorted('epic:a-1')).toEqual(['a-1', 'a-2', 'a-3'])
  })
  it('C5 project: by id and by name substring', () => {
    expect(ids('project:beta')).toEqual(['b-1'])
    expect(ids('project:LPH zebra').sort()).toEqual(['a-2', 'a-3', 'a-4'])
  })
  it('C6 @name is a substring match on assignee', () => {
    expect(ids('@mwan')).toEqual(['a-2'])
    expect(ids('@nobody')).toEqual([])
  })
  it('C7 mine / @me / is:mine need the user name', () => {
    expect(ids('mine', { me: 'ana mwangi' })).toEqual(['a-2'])
    expect(ids('@me', { me: 'Ana Mwangi' })).toEqual(['a-2'])
    expect(ids('is:mine', { me: 'ana mwangi' })).toEqual(['a-2'])
    expect(ids('mine')).toEqual([])
  })
  it('C8 is:ready excludes blocked, waiting and closed', () => {
    const r = ids('is:ready')
    expect(r).toContain('a-9')
    for (const x of ['a-6', 'a-13', 'a-4']) expect(r).not.toContain(x)
  })
  it('C9 is:blocked includes status blocked and waiting_on', () => {
    expect(sorted('is:blocked')).toEqual(['a-13', 'a-6'])
  })
  it('C10 is:since only in the since-project, only newer', () => {
    const since = { project: 'alpha', at: Date.parse('2026-06-15T00:00:00Z') }
    expect(ids('is:since', { since })).toEqual(['a-4'])
    expect(ids('is:since')).toEqual([])
  })
  it('C11 combined chips AND', () => {
    expect(ids('project:alpha label:bill')).toEqual(['a-2'])
    expect(ids('project:beta label:bill type:epic')).toEqual([])
  })
  it('C12 chip without value is a plain word', () => {
    expect(buildQuery([], 'status: x ').words).toEqual(['status:', 'x'])
    expect(ids('status:')).toEqual([])
  })
  it('C13 unknown chip key is a plain word', () => {
    expect(buildQuery([], 'foo:bar').chips).toEqual([])
    expect(ids('foo:bar')).toEqual([])
    expect(buildQuery([], 'is:nope').chips).toEqual([])
  })
  it('C14 duplicate chips equal one chip', () => {
    expect(sorted('label:bill label:bill')).toEqual(sorted('label:bill'))
  })
  it('C15 chip + free text', () => {
    expect(ids('zebra project:beta')).toEqual(['b-1'])
    expect(ids('zebra status:closed')).toEqual(['a-4'])
  })
  it('C15 chip alone lists everything it matches at score 0', () => {
    expect(run('type:epic')[0].score).toBe(0)
  })
})

describe('D bead state', () => {
  it.each([
    ['D1 open', 'Refund', 'a-2'],
    ['D2 in_progress', 'stripes', 'a-3'],
    ['D3 blocked', 'widget', 'a-6'],
    ['D4 deferred', 'gadget', 'a-7'],
    ['D5 closed', 'closed zebra', 'a-4'],
    ['D6 epic', 'overhaul', 'a-1'],
    ['D8 molecule', 'mol', 'a-8'],
    ['D9 bare bead found by title', 'bare', 'a-9'],
  ])('%s is searchable', (_c, q, id) => {
    expect(ids(q)).toContain(id)
  })
  it('D5 closed long ago is still returned (no 7-day window in the engine)', () => {
    const old = proj('o', 'Old', [
      bead('o-1', {
        title: 'ancient zebra',
        status: 'closed',
        updated_at: '2020-01-01T00:00:00Z',
      }),
    ])
    expect(ids('ancient', {}, old)).toEqual(['o-1'])
  })
  it('D7·D9 task with nothing but a title matches only by id/title', () => {
    expect(ids('bare')).toEqual(['a-9'])
    expect(ids('mwangi')).not.toContain('a-9')
  })
  it('D9 missing/garbage timestamps do not break ordering', () => {
    const d = proj('t', 'T', [
      bead('t-1', { title: 'same', updated_at: 'nope' }),
      bead('t-2', { title: 'same', updated_at: undefined }),
    ])
    expect(ids('same', {}, d)).toEqual(['t-1', 't-2'])
  })
})

describe('E ranking and grouping', () => {
  const c = (project: string, rows: [string, string][]) =>
    indexComments(
      project,
      rows.map(([bead_id, text]) => ({ bead_id, text })),
    )

  it('E1 exact id first even when closed', () => {
    const d = proj('p', 'P', [
      bead('x-1', { title: 'x-1 old', status: 'closed' }),
      bead('x-2', { title: 'about x-1 things' }),
      bead('x-3', { title: 'x-1 prefix' }),
    ])
    expect(ids('x-1', {}, d)[0]).toBe('x-1')
  })
  it('E2 title prefix > title word > title substring', () => {
    const d = proj('p', 'P', [
      bead('t-1', { title: 'xfoo' }),
      bead('t-2', { title: 'a foo' }),
      bead('t-3', { title: 'foo a' }),
    ])
    expect(ids('foo', {}, d)).toEqual(['t-3', 't-2', 't-1'])
  })
  it('E3 title > labels', () => {
    const d = proj('p', 'P', [
      bead('t-1', { title: 'n', labels: ['foo'] }),
      bead('t-2', { title: 'xfoo' }),
    ])
    expect(ids('foo', {}, d)).toEqual(['t-2', 't-1'])
  })
  it('E4 labels/assignee > description', () => {
    const d = proj('p', 'P', [
      bead('t-1', { title: 'n', description: 'foo' }),
      bead('t-2', { title: 'n', assignee: 'foo' }),
      bead('t-3', { title: 'n', labels: ['foo'] }),
    ])
    expect(ids('foo', {}, d).slice(0, 2).sort()).toEqual(['t-2', 't-3'])
    expect(ids('foo', {}, d)[2]).toBe('t-1')
  })
  it('E5 description > comment (comment sits in the late group)', () => {
    const d = proj('p', 'P', [
      bead('t-1', { title: 'n', description: 'foo' }),
      bead('t-2', { title: 'n' }),
    ])
    const hits = run('foo', { comments: c('p', [['t-2', 'foo']]) }, d)
    expect(hits.map((h) => [h.doc.bead.id, h.late])).toEqual([
      ['t-1', false],
      ['t-2', true],
    ])
  })
  it('E6 closed last whatever the score', () => {
    expect(ids('zebra').slice(-1)).toEqual(['a-4'])
  })
  it('E7 comment and artifact hits go to the late group after the main rows', () => {
    const hits = run('quokka chargeback', {
      comments: c('alpha', [['a-5', 'chargeback']]),
    })
    expect(hits.map((h) => [h.doc.bead.id, h.late])).toEqual([['a-5', true]])
    const mixed = run('zebra', { comments: c('alpha', [['a-6', 'zebra']]) })
    expect(mixed.at(-1)).toMatchObject({ late: true })
    expect(mixed.slice(0, -1).every((h) => !h.late)).toBe(true)
  })
  it('E8 equal scores: newest first, then key — independent of input order', () => {
    const base = [
      bead('t-a', { title: 'same', updated_at: '2026-01-01T00:00:00Z' }),
      bead('t-b', { title: 'same', updated_at: '2026-02-01T00:00:00Z' }),
      bead('t-c', { title: 'same', updated_at: '2026-02-01T00:00:00Z' }),
    ]
    const want = ['t-b', 't-c', 't-a']
    expect(ids('same', {}, proj('p', 'P', base))).toEqual(want)
    expect(ids('same', {}, proj('p', 'P', [...base].reverse()))).toEqual(want)
  })
  const many = (n: number, f: (i: number) => Partial<Bead>) =>
    proj(
      'p',
      'P',
      Array.from({ length: n }, (_, i) => bead(`m-${i}`, f(i))),
    )
  it('E9 main rows capped at the limit', () => {
    const d = many(80, () => ({ title: 'cap' }))
    expect(ids('cap', {}, d)).toHaveLength(DEFAULT_LIMIT)
    expect(ids('cap', { limit: 3 }, d)).toHaveLength(3)
  })
  it('E10 late rows capped separately', () => {
    const d = many(80, () => ({ title: 'n' }))
    const comments = c(
      'p',
      Array.from(
        { length: 80 },
        (_, i) => [`m-${i}`, 'cap'] as [string, string],
      ),
    )
    const hits = run('cap', { comments }, d)
    expect(hits).toHaveLength(LATE_LIMIT)
    expect(hits.every((h) => h.late)).toBe(true)
  })
  it('E11 highlight ranges: title and id, multi-word, merged on overlap', () => {
    const [h] = run('zeb ebra')
    expect(h.titleRanges).toEqual([{ start: 0, end: 5 }])
    const [i] = run('a-2')
    expect(i.idRanges).toEqual([{ start: 0, end: 3 }])
    const [g] = run('re fl')
    expect(g.titleRanges).toEqual([
      { start: 0, end: 2 },
      { start: 7, end: 9 },
    ])
  })
  it('E11 fuzzy title highlights the matched letters', () => {
    const r = run('rfnd')[0].titleRanges
    expect(
      r.map(({ start, end }) => 'refund flow'.slice(start, end)).join(''),
    ).toBe('rfnd')
  })
  it.each([
    ['start', 'foo ' + 'x '.repeat(80), 0],
    ['end', 'x '.repeat(80) + ' foo', 161],
    ['middle', 'x '.repeat(60) + 'foo ' + 'y '.repeat(60), 120],
    ['whole short text', 'a foo b', 2],
  ])('E12 snippet bounds %s', (_n, text, at) => {
    const s = makeSnippet(text, [{ start: at, end: at + 3 }])
    expect(s.text.length).toBeLessThanOrEqual(2 * 44 + 3 + 2)
    expect(s.ranges).toHaveLength(1)
    expect(s.text.slice(s.ranges[0].start, s.ranges[0].end)).toBe('foo')
  })
  it('E12 snippet: range overlapping the cut is clipped inside the window', () => {
    const s = makeSnippet('x'.repeat(200), [{ start: 100, end: 190 }])
    for (const r of s.ranges) {
      expect(r.start).toBeGreaterThanOrEqual(0)
      expect(r.end).toBeLessThanOrEqual(s.text.length)
    }
  })
  it('E12 snippet from a search hit has a kind and bounded text', () => {
    const [h] = run('declined')
    expect(h.snippet?.kind).toBe('description')
    const { text, ranges } = h.snippet!
    expect(text.slice(ranges[0].start, ranges[0].end).toLowerCase()).toBe(
      'declined',
    )
  })
  it('E12 two hits of the word in one text: one clean range (best occurrence)', () => {
    const s = run(
      'foo',
      {},
      proj('p', 'P', [
        bead('t-1', { title: 'n', description: 'foo and foo again' }),
      ]),
    )[0].snippet!
    expect(s.ranges).toHaveLength(1)
  })
})

describe('F cross-project', () => {
  it('F1 same text in two projects: both returned, distinct keys', () => {
    const r = run('zebra stripes')
    expect(r.map((h) => h.doc.key).sort()).toEqual(['alpha:a-3', 'beta:b-1'])
  })
  it('F2 project: chip narrows to one', () => {
    expect(ids('zebra stripes project:alpha')).toEqual(['a-3'])
  })
  it('F3 no scope toggle in the engine: default is all projects', () => {
    expect(new Set(run('zebra').map((h) => h.doc.project))).toEqual(
      new Set(['alpha', 'beta']),
    )
  })
  it('F3 a colliding bead id in two projects does not collapse', () => {
    const d = [
      ...proj('p', 'P', [bead('x-1', { title: 'dup' })]),
      ...proj('q', 'Q', [bead('x-1', { title: 'dup' })]),
    ]
    expect(run('dup', {}, d).map((h) => h.doc.key)).toEqual(['p:x-1', 'q:x-1'])
  })
  it('F4 read-only project searches identically (same docs shape)', () => {
    const a = run('zebra', {}, proj('rw', 'RW', ALPHA)).map(
      (h) => h.doc.bead.id,
    )
    const b = run('zebra', {}, proj('ro', 'RO', ALPHA)).map(
      (h) => h.doc.bead.id,
    )
    expect(b).toEqual(a)
  })
})

describe('F scope toggle (engine option behind the pill)', () => {
  it('F5 scope = current project hides other projects', () => {
    expect(ids('zebra stripes', { scope: 'alpha' })).toEqual(['a-3'])
    expect(ids('zebra stripes', { scope: 'beta' })).toEqual(['b-1'])
  })
  it('F5 scope undefined = all projects', () => {
    expect(ids('zebra stripes', {}).sort()).toEqual(['a-3', 'b-1'])
  })
  it('F6 project: chip overrides the scope pill', () => {
    expect(ids('zebra stripes project:beta', { scope: 'alpha' })).toEqual([
      'b-1',
    ])
  })
  it('F5 scope applies to chip-only queries too', () => {
    expect(ids('label:billing', { scope: 'beta' })).toEqual(['b-1'])
  })
})

describe('F scope switcher', () => {
  it('F7 scope can be a project other than the current one', () => {
    expect(ids('zebra stripes', { scope: 'beta' })).toEqual(['b-1'])
  })
  it('F8 cycle order: current, All, then the others, wrapping', () => {
    const all = ['a', 'b', 'c']
    expect(scopeCycle('b', 'b', all)).toBe('all')
    expect(scopeCycle('all', 'b', all)).toBe('a')
    expect(scopeCycle('a', 'b', all)).toBe('c')
    expect(scopeCycle('c', 'b', all)).toBe('b')
  })
  it('F8 cycle with no current project (dashboard) starts at All', () => {
    expect(scopeCycle('all', undefined, ['a', 'b'])).toBe('a')
    expect(scopeCycle('b', undefined, ['a', 'b'])).toBe('all')
  })
  it('F8 a vanished scope cycles to the first entry, no throw', () => {
    expect(scopeCycle('gone', 'a', ['a', 'b'])).toBe('a')
  })
  it('F6 project: chip overrides a non-current scope too', () => {
    expect(ids('zebra stripes project:alpha', { scope: 'beta' })).toEqual([
      'a-3',
    ])
  })
})

describe('G index timing', () => {
  const comments = indexComments('alpha', [
    { bead_id: 'a-9', text: 'chargeback dispute' },
  ])
  it('G1 before the comment index: main results only', () => {
    expect(run('chargeback')).toEqual([])
  })
  it('G2 after: late row appears, main rows unchanged and in the same order', () => {
    const before = run('zebra')
    const after = run('zebra', {
      comments: indexComments('alpha', [{ bead_id: 'a-9', text: 'zebra' }]),
    })
    expect(after.slice(0, before.length)).toEqual(before)
    expect(after.at(-1)).toMatchObject({ late: true })
    expect(after.at(-1)!.doc.bead.id).toBe('a-9')
    expect(run('chargeback', { comments })[0].snippet?.kind).toBe('comment')
  })
  it('G2 a comment never demotes a bead already matched in title', () => {
    const r = run('zebra', {
      comments: indexComments('alpha', [{ bead_id: 'a-3', text: 'zebra' }]),
    })
    expect(r.find((h) => h.doc.bead.id === 'a-3')!.late).toBe(false)
  })
  it('G3 empty/garbage comments are skipped; other beads index fine', () => {
    const m = indexComments('alpha', [
      { bead_id: 'a-1', text: '' },
      { bead_id: 'a-2', text: undefined as unknown as string },
      { bead_id: 'a-3', text: 'ok' },
    ])
    expect([...m.keys()]).toEqual(['alpha:a-3'])
  })
  it('G3 one project with no comments does not affect another', () => {
    const r = run('chargeback', { comments })
    expect(r.map((h) => h.doc.key)).toEqual(['alpha:a-9'])
  })
  it('G3 comments per bead are capped at 30 and 1000 chars', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      bead_id: 'a-1',
      text: `c${i}`,
    }))
    expect(indexComments('alpha', rows).get('alpha:a-1')).toHaveLength(30)
    const long = indexComments('alpha', [
      { bead_id: 'a-1', text: 'x'.repeat(5000) },
    ])
    expect(long.get('alpha:a-1')![0].text).toHaveLength(1000)
  })
})

// Hand-rolled seeded PRNG: fast-check is not a dependency.
function rng(seed: number) {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32
}
const ALPHABET = [
  'a',
  'b',
  'z',
  'e',
  ' ',
  '-',
  '.',
  '*',
  '[',
  '\\',
  'é',
  'é',
  '🚀',
  'İ',
  ':',
  '@',
  '1',
  'status:',
  'is:',
  '\u0000',
]
const rand = (r: () => number) =>
  Array.from(
    { length: Math.floor(r() * 12) },
    () => ALPHABET[Math.floor(r() * ALPHABET.length)],
  ).join('')

describe('P properties (seeded)', () => {
  const comments = indexComments('alpha', [{ bead_id: 'a-9', text: 'zebra é' }])
  const strings = (() => {
    const r = rng(42)
    return Array.from({ length: 400 }, () => rand(r))
  })()
  it('P1 deterministic', () => {
    for (const q of strings)
      expect(run(q, { comments })).toEqual(run(q, { comments }))
  })
  it('P2 never throws, any string', () => {
    for (const q of [...strings, '\ud800', 'x'.repeat(10_000), '́']) {
      expect(() =>
        run(q, { comments, me: 'ana', since: { project: 'alpha', at: 0 } }),
      ).not.toThrow()
    }
  })
  it('P3 every returned row contains each query word in an indexed field (or fuzzy-subsequences the title)', () => {
    for (const q of strings) {
      const query = buildQuery([], q)
      for (const h of searchDocs(ALL, query, { comments })) {
        const b = h.doc.bead
        const fields = [
          b.id,
          b.title,
          b.description ?? '',
          b.assignee ?? '',
          ...(b.labels ?? []),
          ...h.doc.artifacts.map((a) => a.text),
          ...(comments.get(h.doc.key) ?? []).map((c) => c.text),
        ]
          .map((s) => s.toLowerCase().replace(/\s+/g, ' '))
          .map(fold)
        for (const w of query.words) {
          const word = fold(w)
          const sub = (hay: string) => {
            let i = -1
            for (const ch of word) {
              i = hay.indexOf(ch, i + 1)
              if (i < 0) return false
            }
            return true
          }
          const budget = /^\p{L}+$/u.test(word)
            ? word.length >= 8
              ? 2
              : word.length >= 5
                ? 1
                : 0
            : 0
          const typo =
            budget > 0 &&
            fields.some((f) =>
              f
                .split(/[^\p{L}\p{N}]+/u)
                .some((t) => editDistance(t, word, budget) <= budget),
            )
          const ok =
            fields.some((f) => f.includes(word)) ||
            typo ||
            (word.length >= 3 && sub(fold(b.title.toLowerCase())))
          expect(
            ok,
            `q=${JSON.stringify(q)} word=${JSON.stringify(word)} bead=${b.id}`,
          ).toBe(true)
        }
      }
    }
  })
  it('P4 adding a chip never adds results', () => {
    const chips = [
      'status:open',
      'type:task',
      'label:bill',
      'epic:pay',
      'project:alpha',
      '@ana',
      'is:ready',
      'is:blocked',
    ]
    const r = rng(7)
    for (let n = 0; n < 200; n++) {
      const q = rand(r)
      const chip = chips[Math.floor(r() * chips.length)]
      const base = new Set(
        searchDocs(ALL, buildQuery([], q), { me: 'ana' }).map((h) => h.doc.key),
      )
      const more = searchDocs(ALL, buildQuery([], `${q} ${chip}`), {
        me: 'ana',
      }).map((h) => h.doc.key)
      // a chip-only query lists chip matches, so compare against the unchipped result only when words remain
      if (buildQuery([], q).words.length)
        for (const k of more) expect(base.has(k), `${q} + ${chip}`).toBe(true)
    }
  })
})
