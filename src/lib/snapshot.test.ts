import { describe, expect, it } from 'vitest'

import {
  buildBeadDetail,
  buildBeadGraph,
  buildProjectKnowledge,
  buildSnapshot,
} from './bd.ts'
import { parseQuestions } from './bead-questions.ts'
import {
  addComment,
  insertBead,
  isListed,
  patchBead,
  removeBead,
  selectBoard,
  selectDetail,
  selectKnowledge,
  setComments,
} from './snapshot.ts'
import {
  blockedText,
  commentRows,
  exportRows,
  exportText,
  listRows,
  readyText,
  showRows,
} from './snapshot-fixture.ts'

import type { Bead } from './types.ts'

const snapshot = buildSnapshot(exportText, readyText, blockedText)

describe('buildSnapshot', () => {
  it('carries comments, labels and edges per bead', () => {
    const child = snapshot.beads.find((b) => b.id === 'syn-1.1')!
    expect(child.labels).toEqual(['alpha', 'beta'])
    expect(child.comments.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(child.edges).toEqual([
      { from: 'syn-1.1', to: 'syn-2', type: 'blocks' },
      { from: 'syn-1.1', to: 'syn-1', type: 'parent-child' },
      { from: 'syn-1.1', to: 'syn-3', type: 'blocks' },
    ])
    expect(snapshot.ready).toEqual(['syn-1', 'syn-2'])
    expect(snapshot.blocked).toEqual([
      { id: 'syn-1.1', blocked_by: ['syn-2', 'syn-3'] },
    ])
  })

  it('leaves ready/blocked null when bd could not answer, and hashes the content', () => {
    const lean = buildSnapshot(exportText, undefined, 'not json')
    expect(lean.ready).toBeNull()
    expect(lean.blocked).toBeNull()
    expect(lean.cursor).toMatch(/^[0-9a-f]{16}$/)
    expect(lean.cursor).not.toBe(snapshot.cursor)
    expect(buildSnapshot(exportText, readyText, blockedText).cursor).toBe(
      snapshot.cursor,
    )
  })
})

describe('selectBoard', () => {
  it('hides what bd list hides: the gate, and edges to it', () => {
    const board = selectBoard(snapshot)
    expect(board.map((b) => b.id)).not.toContain('syn-3')
    expect(isListed({ issue_type: 'gate' })).toBe(false)
    expect(isListed({ issue_type: 'task' })).toBe(true)
    const child = board.find((b) => b.id === 'syn-1.1')!
    expect(child.links?.map((l) => l.id)).toEqual(['syn-2', 'syn-1'])
  })

  it('equals the list-based graph the server used to build', () => {
    const viaList = buildBeadGraph(listRows, {
      blocked: JSON.parse(blockedText) as Record<string, unknown>[],
      ready: JSON.parse(readyText) as Record<string, unknown>[],
    })
    expect(JSON.parse(JSON.stringify(selectBoard(snapshot)))).toEqual(
      JSON.parse(JSON.stringify(viaList)),
    )
  })

  it('takes parent from the parent-child edge when the row has none, and derives children', () => {
    const rows = exportRows.map(({ parent: _parent, ...r }) => r)
    const board = selectBoard(
      buildSnapshot(rows.map((r) => JSON.stringify(r)).join('\n'), '[]', '[]'),
    )
    expect(board.find((b) => b.id === 'syn-1.1')?.parent).toBe('syn-1')
    expect(board.find((b) => b.id === 'syn-1')?.children).toEqual(['syn-1.1'])
    expect(board.find((b) => b.id === 'syn-1')?.childBeads?.[0].id).toBe(
      'syn-1.1',
    )
  })

  it('stamps nothing when ready/blocked are unknown, and drops nulls from the Rust side', () => {
    const lean = buildSnapshot(exportText, undefined, undefined)
    const withNulls = {
      ...lean,
      beads: lean.beads.map((b) => ({
        ...b,
        children: null,
        childBeads: null,
      })),
    } as unknown as typeof lean
    const board = selectBoard(withNulls)
    expect(board.every((b) => b.ready === undefined)).toBe(true)
    expect(board.every((b) => b.waiting_on === undefined)).toBe(true)
    expect(board.find((b) => b.id === 'syn-2')?.children).toBeUndefined()
  })
})

// Fields the modal and its edit/delete dialogs render from the detail.
const RENDERED: (keyof Bead | 'dependencies' | 'comments')[] = [
  'id',
  'title',
  'description',
  'acceptance_criteria',
  'design',
  'notes',
  'status',
  'priority',
  'issue_type',
  'assignee',
  'owner',
  'created_at',
  'updated_at',
  'closed_at',
  'labels',
  'parent',
  'spec_id',
  'external_ref',
  'metadata',
  'comment_count',
  'dependency_count',
  'dependent_count',
  'dependencies',
  'comments',
]

const pick = (detail: object) =>
  JSON.parse(
    JSON.stringify(
      Object.fromEntries(
        RENDERED.map((k) => [k, (detail as Record<string, unknown>)[k]]),
      ),
    ),
  )

describe('parity with bd show', () => {
  for (const id of Object.keys(showRows)) {
    it(`${id}: the snapshot detail equals the show-based detail`, () => {
      const viaShow = buildBeadDetail(showRows[id], commentRows[id] ?? [])
      const viaSnapshot = selectDetail(snapshot, id)!
      expect(pick(viaSnapshot)).toEqual(pick(viaShow))
    })
  }

  it('joins edge targets by id, gates included', () => {
    const detail = selectDetail(snapshot, 'syn-1.1')!
    expect(detail.dependencies?.map((d) => [d.id, d.issue_type])).toEqual([
      ['syn-2', 'bug'],
      ['syn-1', 'epic'],
      ['syn-3', 'gate'],
    ])
  })

  it('is undefined for a bead the snapshot lacks', () => {
    expect(selectDetail(snapshot, 'syn-404')).toBeUndefined()
  })
})

describe('selectKnowledge', () => {
  it('equals the export-based project knowledge', () => {
    expect(JSON.parse(JSON.stringify(selectKnowledge(snapshot)))).toEqual(
      JSON.parse(JSON.stringify(buildProjectKnowledge(exportRows))),
    )
  })

  it('lists typed entries newest first', () => {
    const { knowledge } = selectKnowledge(snapshot)
    expect(knowledge.map((k) => [k.type, k.bead_id])).toEqual([
      ['decision', 'syn-4'],
      ['learned', 'syn-1.1'],
    ])
  })
})

describe('question state from the snapshot', () => {
  it('parses the :::question block and its ANSWER from the detail comments', () => {
    const [q] = parseQuestions(selectDetail(snapshot, 'syn-1.1')!.comments!)
    expect(q.id).toBe('q1')
    expect(q.options).toEqual(['Alpha', 'Beta'])
    expect(q.answered?.choice).toBe('Beta')
  })
})

describe('patches', () => {
  it('adds a comment and keeps the count', () => {
    const next = addComment(snapshot, 'syn-2', { id: 'p', text: 'hi' })
    const detail = selectDetail(next, 'syn-2')!
    expect(detail.comments?.map((c) => c.id)).toEqual(['p'])
    expect(detail.comment_count).toBe(1)
    expect(snapshot.beads.find((b) => b.id === 'syn-2')?.comments).toEqual([])
    expect(setComments(snapshot, 'syn-2', []).beads).toHaveLength(5)
  })

  it('patches fields without touching the original', () => {
    const next = patchBead(snapshot, 'syn-2', { status: 'closed' })
    expect(selectBoard(next).find((b) => b.id === 'syn-2')?.status).toBe(
      'closed',
    )
    expect(selectBoard(snapshot).find((b) => b.id === 'syn-2')?.status).toBe(
      'in_progress',
    )
  })

  it('removes a bead with its descendants, and inserts once', () => {
    expect(removeBead(snapshot, 'syn-1').beads.map((b) => b.id)).toEqual([
      'syn-2',
      'syn-3',
      'syn-4',
    ])
    const bead = { ...snapshot.beads[0], id: 'syn-9', edges: [], comments: [] }
    expect(insertBead(insertBead(snapshot, bead), bead).beads).toHaveLength(6)
  })
})
