/** Command palette search over beads already in memory: fuzzy score, highlight ranges, snippets, ranking. Pure. */
import { beadArtifacts } from './artifacts'
import { beadColumn, isEpic } from './types'

import type { Chip, PaletteQuery } from './palette-query'
import type { Bead, ProjectComment } from './types'

export interface Range {
  start: number
  end: number
}

export type MatchKind = 'prefix' | 'word' | 'sub' | 'fuzzy'

export interface TextMatch {
  kind: MatchKind
  ranges: Range[]
}

const KIND_RANK: Record<MatchKind, number> = {
  prefix: 3,
  word: 2,
  sub: 1,
  fuzzy: 0,
}

/** Rank order: exact id > title prefix > title > labels/assignee > description > comments > artifacts. */
export const WEIGHT = {
  idExact: 1000,
  idPrefix: 850,
  idPart: 650,
  titlePrefix: 800,
  titleWord: 640,
  titleSub: 600,
  titleFuzzy: 500,
  meta: 400,
  metaPrefix: 420,
  description: 300,
  descriptionWord: 310,
  comment: 200,
  artifact: 180,
} as const

const MAX_OCCURRENCES = 50
const MAX_FUZZY_STARTS = 5

function isWordChar(c: string | undefined): boolean {
  return c !== undefined && /[a-z0-9]/i.test(c)
}

/**
 * Where `word` (already lower-case) occurs in `hay` (lower-case). Plain substring search, never a
 * regex, so special characters in the query are inert. Prefers a match at the start, then at a
 * word start, then inside a word; `fuzzy` falls back to an in-order subsequence with a tight span.
 */
export function matchText(
  hay: string,
  word: string,
  fuzzy = false,
): TextMatch | null {
  if (!word || !hay) return null
  let best: TextMatch | null = null
  let from = 0
  for (let n = 0; n < MAX_OCCURRENCES; n++) {
    const i = hay.indexOf(word, from)
    if (i < 0) break
    const kind: MatchKind =
      i === 0 ? 'prefix' : isWordChar(hay[i - 1]) ? 'sub' : 'word'
    if (!best || KIND_RANK[kind] > KIND_RANK[best.kind])
      best = { kind, ranges: [{ start: i, end: i + word.length }] }
    if (kind === 'prefix') break
    from = i + 1
  }
  if (best || !fuzzy || word.length < 3) return best

  let start = hay.indexOf(word[0])
  for (let tries = 0; start >= 0 && tries < MAX_FUZZY_STARTS; tries++) {
    const positions = [start]
    let pos = start
    for (let k = 1; k < word.length; k++) {
      pos = hay.indexOf(word[k], pos + 1)
      if (pos < 0) break
      positions.push(pos)
    }
    if (positions.length === word.length) {
      if (pos - start <= word.length * 2) {
        const ranges: Range[] = []
        for (const p of positions) {
          const last = ranges.at(-1)
          if (last && last.end === p) last.end = p + 1
          else ranges.push({ start: p, end: p + 1 })
        }
        return { kind: 'fuzzy', ranges }
      }
    } else break
    start = hay.indexOf(word[0], start + 1)
  }
  return null
}

/** Sorted, overlapping/adjacent ranges merged. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const out: Range[] = []
  for (const r of sorted) {
    const last = out.at(-1)
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

export interface Snippet {
  text: string
  ranges: Range[]
}

/**
 * A window of about `2 * radius` characters around the first range, cut at word boundaries and
 * marked with an ellipsis where text was dropped. Ranges are shifted into the window.
 */
export function makeSnippet(
  text: string,
  ranges: Range[],
  radius = 44,
): Snippet {
  const first = ranges[0]
  if (!text || !first) return { text: text.slice(0, radius * 2), ranges: [] }
  let from = Math.max(0, first.start - radius)
  let to = Math.min(text.length, Math.max(first.end, first.start) + radius)
  if (from > 0) {
    const space = text.indexOf(' ', from)
    if (space >= 0 && space < first.start) from = space + 1
  }
  if (to < text.length) {
    const space = text.lastIndexOf(' ', to)
    if (space > first.end) to = space
  }
  const head = from > 0 ? '…' : ''
  const tail = to < text.length ? '…' : ''
  const shift = head.length - from
  const inside: Range[] = []
  for (const r of ranges) {
    const start = Math.max(r.start, from)
    const end = Math.min(r.end, to)
    if (end > start) inside.push({ start: start + shift, end: end + shift })
  }
  return {
    text: head + text.slice(from, to) + tail,
    ranges: mergeRanges(inside),
  }
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

export interface IndexedText {
  text: string
  lower: string
}

const indexed = (s: string): IndexedText => {
  const text = collapse(s)
  return { text, lower: text.toLowerCase() }
}

export interface PaletteDoc {
  key: string
  project: string
  projectName: string
  bead: Bead
  idL: string
  titleL: string
  labels: IndexedText[]
  assignee?: IndexedText
  description?: IndexedText
  artifacts: IndexedText[]
  epicId?: string
  epicTitle?: string
  closed: boolean
  updatedMs: number
}

export const docKey = (project: string, id: string) => `${project}:${id}`

const MAX_ANCESTORS = 8

/** Docs for one project's beads; the nearest epic ancestor becomes the "parent epic". */
export function buildDocs(
  project: { id: string; name: string },
  beads: Bead[],
): PaletteDoc[] {
  const byId = new Map(beads.map((b) => [b.id, b]))
  return beads.map((bead) => {
    let epic: Bead | undefined
    let up = bead.parent ? byId.get(bead.parent) : undefined
    for (let n = 0; up && n < MAX_ANCESTORS; n++) {
      if (isEpic(up)) {
        epic = up
        break
      }
      up = up.parent ? byId.get(up.parent) : undefined
    }
    const t = Date.parse(bead.updated_at ?? bead.created_at ?? '')
    return {
      key: docKey(project.id, bead.id),
      project: project.id,
      projectName: project.name,
      bead,
      idL: bead.id.toLowerCase(),
      titleL: bead.title.toLowerCase(),
      labels: (bead.labels ?? []).map(indexed),
      assignee: bead.assignee ? indexed(bead.assignee) : undefined,
      description: bead.description ? indexed(bead.description) : undefined,
      artifacts: beadArtifacts(bead).flatMap((a) => [
        indexed(a.path),
        ...(a.label !== a.path ? [indexed(a.label)] : []),
      ]),
      epicId: epic?.id,
      epicTitle: epic?.title,
      closed: beadColumn(bead) === 'closed',
      updatedMs: Number.isNaN(t) ? 0 : t,
    }
  })
}

const MAX_COMMENTS_PER_BEAD = 30
const MAX_COMMENT_CHARS = 1000

/** Comment texts per doc key, lower-cased once. Bounded per bead and per comment. */
export function indexComments(
  project: string,
  comments: Pick<ProjectComment, 'bead_id' | 'text'>[],
): Map<string, IndexedText[]> {
  const out = new Map<string, IndexedText[]>()
  for (const c of comments) {
    if (!c.text) continue
    const key = docKey(project, c.bead_id)
    const list = out.get(key) ?? []
    if (list.length < MAX_COMMENTS_PER_BEAD)
      list.push(indexed(c.text.slice(0, MAX_COMMENT_CHARS)))
    out.set(key, list)
  }
  return out
}

export type SnippetKind =
  | 'label'
  | 'assignee'
  | 'description'
  | 'comment'
  | 'artifact'

export interface PaletteHit {
  doc: PaletteDoc
  score: number
  idRanges: Range[]
  titleRanges: Range[]
  snippet?: Snippet & { kind: SnippetKind }
}

interface WordHit {
  score: number
  field: 'id' | 'title' | SnippetKind
  match: TextMatch
  text?: string
}

function bestForWord(
  doc: PaletteDoc,
  word: string,
  comments: IndexedText[],
): WordHit | null {
  let best: WordHit | null = null
  const consider = (
    score: number,
    field: WordHit['field'],
    match: TextMatch | null,
    text?: string,
  ) => {
    if (match && (!best || score > best.score))
      best = { score, field, match, text }
  }

  const id = matchText(doc.idL, word)
  consider(
    doc.idL === word
      ? WEIGHT.idExact
      : id?.kind === 'prefix'
        ? WEIGHT.idPrefix
        : WEIGHT.idPart,
    'id',
    id,
  )
  const title = matchText(doc.titleL, word, true)
  consider(
    title?.kind === 'prefix'
      ? WEIGHT.titlePrefix
      : title?.kind === 'word'
        ? WEIGHT.titleWord
        : title?.kind === 'sub'
          ? WEIGHT.titleSub
          : WEIGHT.titleFuzzy,
    'title',
    title,
  )
  const meta = (kind: SnippetKind, item: IndexedText | undefined) => {
    const m = item && matchText(item.lower, word)
    consider(
      m && m.kind === 'prefix' ? WEIGHT.metaPrefix : WEIGHT.meta,
      kind,
      m || null,
      item?.text,
    )
  }
  for (const label of doc.labels) meta('label', label)
  meta('assignee', doc.assignee)
  if (doc.description) {
    const m = matchText(doc.description.lower, word)
    consider(
      m && (m.kind === 'prefix' || m.kind === 'word')
        ? WEIGHT.descriptionWord
        : WEIGHT.description,
      'description',
      m,
      doc.description.text,
    )
  }
  for (const c of comments)
    consider(WEIGHT.comment, 'comment', matchText(c.lower, word), c.text)
  for (const a of doc.artifacts)
    consider(WEIGHT.artifact, 'artifact', matchText(a.lower, word), a.text)
  return best
}

function matchesStatus(doc: PaletteDoc, value: string): boolean {
  const v = value.toLowerCase().replace(/-/g, '_')
  const raw = String(doc.bead.status).toLowerCase()
  return raw.startsWith(v) || beadColumn(doc.bead).startsWith(v)
}

/** Chips narrow results; every chip must hold. Values match case-insensitively by prefix. */
export function passesChip(doc: PaletteDoc, chip: Chip): boolean {
  const v = chip.value.toLowerCase()
  switch (chip.kind) {
    case 'status':
      return matchesStatus(doc, chip.value)
    case 'type':
      return doc.bead.issue_type.toLowerCase().startsWith(v)
    case 'label':
      return doc.labels.some((l) => l.lower.startsWith(v))
    case 'assignee':
      return doc.assignee?.lower.includes(v) ?? false
    case 'epic':
      // The epic itself counts as being "in" it.
      return [
        doc.epicId,
        doc.epicTitle,
        isEpic(doc.bead) ? doc.bead.id : undefined,
        isEpic(doc.bead) ? doc.bead.title : undefined,
      ].some((s) => s?.toLowerCase().includes(v))
  }
}

export interface SearchOptions {
  comments?: Map<string, IndexedText[]>
  /** Restrict to one project id ("Current project" scope). */
  project?: string
  limit?: number
}

export const DEFAULT_LIMIT = 50

/** Closed beads sort last whatever their score; otherwise best score, then most recently updated. */
export function compareHits(a: PaletteHit, b: PaletteHit): number {
  return (
    Number(a.doc.closed) - Number(b.doc.closed) ||
    b.score - a.score ||
    b.doc.updatedMs - a.doc.updatedMs ||
    a.doc.key.localeCompare(b.doc.key)
  )
}

export function searchDocs(
  docs: PaletteDoc[],
  query: PaletteQuery,
  opts: SearchOptions = {},
): PaletteHit[] {
  const { words, chips } = query
  if (!words.length && !chips.length) return []
  const hits: PaletteHit[] = []
  for (const doc of docs) {
    if (opts.project && doc.project !== opts.project) continue
    if (!chips.every((c) => passesChip(doc, c))) continue
    if (!words.length) {
      hits.push({ doc, score: 0, idRanges: [], titleRanges: [] })
      continue
    }
    const comments = opts.comments?.get(doc.key) ?? []
    let weakest: WordHit | null = null
    const idRanges: Range[] = []
    const titleRanges: Range[] = []
    for (const word of words) {
      const hit = bestForWord(doc, word, comments)
      if (!hit) {
        weakest = null
        break
      }
      if (!weakest || hit.score < weakest.score) weakest = hit
      idRanges.push(...(matchText(doc.idL, word)?.ranges ?? []))
      titleRanges.push(...(matchText(doc.titleL, word, true)?.ranges ?? []))
    }
    if (!weakest) continue
    const out: PaletteHit = {
      doc,
      score: weakest.score,
      idRanges: mergeRanges(idRanges),
      titleRanges: mergeRanges(titleRanges),
    }
    if (weakest.field !== 'id' && weakest.field !== 'title' && weakest.text)
      out.snippet = {
        kind: weakest.field,
        ...makeSnippet(weakest.text, weakest.match.ranges),
      }
    hits.push(out)
  }
  return hits.sort(compareHits).slice(0, opts.limit ?? DEFAULT_LIMIT)
}
