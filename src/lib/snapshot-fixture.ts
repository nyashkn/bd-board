/**
 * Synthetic bd output for the snapshot tests: `bd export` lines and the matching `bd show --json`,
 * `bd comments --json`, `bd ready` and `bd blocked` outputs. Shapes follow bd 1.3.x; every name,
 * id and text is made up.
 */
type Row = Record<string, unknown>

const stamp = (n: number) => `2026-01-0${n}T10:00:00Z`

const dep = (from: string, to: string, type: string): Row => ({
  issue_id: from,
  depends_on_id: to,
  type,
  created_at: stamp(1),
  created_by: 'tester',
  metadata: '{}',
})

const note = (id: string, bead: string, text: string, day: number): Row => ({
  id,
  issue_id: bead,
  author: 'tester',
  text,
  created_at: stamp(day),
})

const QUESTION = [
  'Which shape?',
  ':::question id=q1',
  'Pick one',
  '- [ ] Alpha',
  '- [ ] Beta',
  'Recommended: Alpha',
  ':::',
].join('\n')

const comments: Record<string, Row[]> = {
  'syn-1.1': [
    note('c1', 'syn-1.1', 'first note', 2),
    note('c2', 'syn-1.1', 'LEARNED: fixtures stay synthetic', 3),
    note('c3', 'syn-1.1', QUESTION, 4),
    note('c4', 'syn-1.1', 'ANSWER: q1 Beta', 5),
  ],
  'syn-4': [note('c5', 'syn-4', 'DECISION: ship it', 6)],
}

const common = (id: string, title: string, over: Row): Row => ({
  id,
  title,
  status: 'open',
  priority: 2,
  issue_type: 'task',
  owner: 'owner@example.com',
  created_at: stamp(1),
  created_by: 'tester',
  updated_at: stamp(2),
  ...over,
})

/** Rows as `bd export` prints them (before `comments` is attached). */
const base: Row[] = [
  common('syn-1', 'Epic one', { issue_type: 'epic' }),
  common('syn-1.1', 'Child task', {
    description: 'Do the thing',
    acceptance_criteria: 'It is done',
    design: 'Small',
    notes: 'Mind the edge',
    assignee: 'alex',
    labels: ['alpha', 'beta'],
    spec_id: 'docs/spec.md',
    external_ref: 'https://example.com/t/1',
    metadata: { artifacts: '[]', n: 3 },
    dependencies: [
      dep('syn-1.1', 'syn-2', 'blocks'),
      dep('syn-1.1', 'syn-1', 'parent-child'),
      dep('syn-1.1', 'syn-3', 'blocks'),
    ],
  }),
  common('syn-2', 'Blocker bug', {
    issue_type: 'bug',
    status: 'in_progress',
    priority: 0,
    dependencies: [],
  }),
  common('syn-3', 'A gate', { issue_type: 'gate' }),
  common('syn-4', 'Finished task', {
    status: 'closed',
    closed_at: stamp(7),
    labels: ['alpha'],
  }),
]

const counts = (row: Row) => {
  const id = row['id'] as string
  const out = base.flatMap(
    (r) => (r['dependencies'] as Row[] | undefined) ?? [],
  )
  return {
    dependency_count: ((row['dependencies'] as Row[] | undefined) ?? []).length,
    dependent_count: out.filter((d) => d['depends_on_id'] === id).length,
    comment_count: (comments[id] ?? []).length,
  }
}

/** `bd export`: counts of the edge kinds export reports, comments inline. */
export const exportRows: Row[] = base.map((row) => ({
  _type: 'issue',
  ...row,
  comments: comments[row['id'] as string] ?? [],
  ...counts(row),
  // export leaves parent-child out of the counts
  ...(row['id'] === 'syn-1.1' ? { dependency_count: 2, parent: 'syn-1' } : {}),
}))
export const exportText = exportRows.map((r) => JSON.stringify(r)).join('\n')

export const readyText = JSON.stringify([
  { id: 'syn-1', title: 'Epic one' },
  { id: 'syn-2', title: 'Blocker bug' },
])
export const blockedText = JSON.stringify([
  {
    id: 'syn-1.1',
    title: 'Child task',
    blocked_by: ['syn-2', 'syn-3'],
    blocked_by_count: 2,
  },
])

/** `bd list --all --json`: export minus comments, `_type` and the gate. */
export const listRows: Row[] = exportRows
  .filter((r) => r['issue_type'] !== 'gate')
  .map(({ comments: _comments, _type, ...row }) => row)

const related = (id: string, type: string): Row => {
  const target = base.find((r) => r['id'] === id)!
  return {
    id,
    title: target['title'],
    status: target['status'],
    priority: target['priority'],
    issue_type: target['issue_type'],
    owner: 'owner@example.com',
    dependency_type: type,
  }
}

/** `bd show <id> --json` (the first element), written out by hand from real output. */
export const showRows: Record<string, Row> = {
  'syn-1': {
    ...base[0],
    dependent_count: 1,
    dependency_count: 0,
    comment_count: 0,
  },
  'syn-1.1': {
    ...base[1],
    dependencies: [
      related('syn-2', 'blocks'),
      related('syn-1', 'parent-child'),
      related('syn-3', 'blocks'),
    ],
    parent: 'syn-1',
    dependent_count: 0,
    dependency_count: 3,
    comment_count: 4,
    comments_omitted: true,
  },
  'syn-2': {
    ...base[2],
    dependencies: [],
    dependent_count: 1,
    dependency_count: 0,
    comment_count: 0,
  },
  'syn-4': {
    ...base[4],
    dependent_count: 0,
    dependency_count: 0,
    comment_count: 1,
  },
}

/** `bd comments <id> --json`. */
export const commentRows = comments
