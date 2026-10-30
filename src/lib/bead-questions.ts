/**
 * Ask and answer on a bead. An agent writes a comment holding a `:::question` block; the owner's
 * pick goes back as a plain `ANSWER: <id> <choice>` comment. Comments only, no bd changes. Pure.
 */

export interface QuestionSource {
  id?: string
  text: string
}

export interface Question {
  id: string
  /** Markdown. */
  text: string
  options: string[]
  /** One of `options`, exactly as written. */
  recommended?: string
  stopped: boolean
  holdsUp: string[]
  /** Index of the comment holding the block. */
  commentIndex: number
  answered?: { choice: string; commentIndex: number }
}

const OPEN = /^:::question\b(.*)$/i
const OPTION = /^[-*]\s+\[[ xX]\]\s+(.+)$/
const RECOMMENDED = /^Recommended:\s*(.+)$/i
const HOLDS_UP = /^Holds up:\s*(.+)$/i
const ANSWER = /^ANSWER:\s*(.+)$/i

const clean = (s: string) => s.trim().replace(/\s+/g, ' ')

/** One block's lines (between the fences) -> a question, or null when nothing askable is in it. */
function parseBlock(
  header: string,
  lines: string[],
  fallbackId: string,
  commentIndex: number,
): Question | null {
  const tokens = header.split(/\s+/).filter(Boolean)
  const id = tokens.find((t) => t.startsWith('id=') && t.length > 3)?.slice(3)
  const options: string[] = []
  const paragraphs: string[] = []
  let para: string[] = []
  let recommended: string | undefined
  let holdsUp: string[] = []
  const flush = () => {
    if (para.length) paragraphs.push(para.join('\n'))
    para = []
  }
  for (const raw of lines) {
    const line = raw.trim()
    const opt = OPTION.exec(line)
    const rec = RECOMMENDED.exec(line)
    const holds = HOLDS_UP.exec(line)
    if (opt) {
      flush()
      options.push(clean(opt[1]))
    } else if (rec) {
      flush()
      recommended = clean(rec[1])
    } else if (holds) {
      flush()
      holdsUp = holds[1].split(/[,\s]+/).filter(Boolean)
    } else if (!line) flush()
    else para.push(line)
  }
  flush()
  if (!options.length) return null
  return {
    id: id ?? fallbackId,
    text: paragraphs[0] ?? '',
    options,
    recommended:
      recommended !== undefined && options.includes(recommended)
        ? recommended
        : undefined,
    stopped: tokens.some((t) => t.toLowerCase() === 'stopped'),
    holdsUp,
    commentIndex,
  }
}

/** Questions in one comment, in order. An unclosed block runs to the end of the comment. */
function questionsIn(c: QuestionSource, index: number): Question[] {
  const out: Question[] = []
  const lines = c.text.split(/\r?\n/)
  const base = c.id || String(index)
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN.exec(lines[i].trim())
    if (!open) continue
    let end = i + 1
    while (end < lines.length && lines[end].trim() !== ':::') end++
    const q = parseBlock(
      open[1],
      lines.slice(i + 1, end),
      out.length ? `${base}-${out.length + 1}` : base,
      index,
    )
    if (q) out.push(q)
    i = end
  }
  return out
}

const sameText = (a: string, b: string) =>
  clean(a).toLowerCase() === b.toLowerCase()

/**
 * Every question in a bead's comments (oldest first), each marked answered by the first later
 * `ANSWER: <id> <choice>` for its id. `ANSWER: <option text>` works when exactly one question is
 * open at that point. Never throws; text that is not a well-formed block is simply not a question.
 */
export function parseQuestions(comments: QuestionSource[]): Question[] {
  const all: Question[] = []
  comments.forEach((c, i) => {
    const head =
      typeof c.text === 'string' ? c.text.trim().split(/\r?\n/)[0] : ''
    const m = ANSWER.exec(head)
    if (m) {
      const rest = clean(m[1])
      const open = all.filter((q) => !q.answered && q.commentIndex < i)
      const [first, ...tail] = rest.split(' ')
      const byId = open.find((q) => q.id === first)
      if (byId && tail.length)
        byId.answered = { choice: tail.join(' '), commentIndex: i }
      else if (!byId && open.length === 1) {
        const opt = open[0].options.find((o) => sameText(rest, o))
        if (opt) open[0].answered = { choice: opt, commentIndex: i }
      }
    }
    if (typeof c.text === 'string') all.push(...questionsIn(c, i))
  })
  return all
}

export function formatAnswer(id: string, choice: string): string {
  return `ANSWER: ${id} ${clean(choice)}`
}

/** Unanswered questions flagged `stopped`: the agent is waiting on the owner. */
export function openStoppedQuestions(comments: QuestionSource[]): Question[] {
  return parseQuestions(comments).filter((q) => q.stopped && !q.answered)
}

/** Splits comment text into plain text and question blocks, for rendering. */
export function splitQuestionBlocks(
  text: string,
): ({ text: string } | { block: number })[] {
  const lines = text.split(/\r?\n/)
  const parts: ({ text: string } | { block: number })[] = []
  let plain: string[] = []
  let block = 0
  for (let i = 0; i < lines.length; i++) {
    if (!OPEN.test(lines[i].trim())) {
      plain.push(lines[i])
      continue
    }
    let end = i + 1
    while (end < lines.length && lines[end].trim() !== ':::') end++
    const body = lines.slice(i + 1, end)
    if (parseBlock('', body, '', 0)) {
      if (plain.join('').trim()) parts.push({ text: plain.join('\n') })
      plain = []
      parts.push({ block: block++ })
      i = end
    } else {
      plain.push(...lines.slice(i, end + 1))
      i = end
    }
  }
  if (plain.join('').trim()) parts.push({ text: plain.join('\n') })
  return parts
}

/** Ids of beads with an unanswered `stopped` question, from a project's comments (any order). */
export function askingBeads(
  comments: {
    bead_id: string
    id?: string
    text: string
    created_at?: string
  }[],
): Set<string> {
  const byBead = new Map<string, typeof comments>()
  for (const c of comments) {
    if (!c.text.includes(':::question')) continue
    byBead.set(c.bead_id, [...(byBead.get(c.bead_id) ?? []), c])
  }
  // Answers are plain comments, so the whole thread of a bead with a question is needed in order.
  const out = new Set<string>()
  for (const [bead, qs] of byBead) {
    const thread = comments
      .filter((c) => c.bead_id === bead)
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
    if (qs.length && openStoppedQuestions(thread).length) out.add(bead)
  }
  return out
}
