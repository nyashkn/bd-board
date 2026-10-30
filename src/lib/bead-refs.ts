// Same shape as BEAD_ID_RE in server-validation.ts (that module is server-only, so the pattern is repeated).
const BEAD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/

export type BeadRefSegment =
  | { type: 'text'; text: string }
  | { type: 'refs'; ids: string[] }

const OPEN_RE = /^ {0,3}:::bead(?:\s+(.*?))?\s*$/
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/
const CLOSE_RE = /^ {0,3}:::\s*$/

/** Ids from a space/comma separated list, or null when empty or any token is not a bead id. */
function parseIds(list: string): string[] | null {
  const ids = list.split(/[\s,]+/).filter(Boolean)
  return ids.length > 0 && ids.every((id) => BEAD_ID_RE.test(id)) ? ids : null
}

/**
 * Splits markdown into text and `:::bead` reference segments. Accepted forms: `:::bead a b`,
 * `:::bead a, b :::`, and a block (`:::bead` / one or more id lines / `:::`). Lenient: anything
 * malformed or unterminated stays text, and fenced code is never touched.
 */
export function splitBeadRefs(markdown: string): BeadRefSegment[] {
  const lines = markdown.split('\n')
  const out: BeadRefSegment[] = []
  let text: string[] = []
  const flush = () => {
    if (text.length) out.push({ type: 'text', text: text.join('\n') })
    text = []
  }

  let fence: { char: string; len: number } | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const f = FENCE_RE.exec(line)
    if (fence) {
      if (
        f &&
        f[1][0] === fence.char &&
        f[1].length >= fence.len &&
        line.trim() === f[1]
      )
        fence = null
      text.push(line)
      continue
    }
    if (f) {
      fence = { char: f[1][0], len: f[1].length }
      text.push(line)
      continue
    }

    const m = OPEN_RE.exec(line)
    let ids: string[] | null = null
    let end = i
    if (m) {
      const rest = ((m[1] as string | undefined) ?? '').replace(/\s*:::$/, '')
      if (rest) ids = parseIds(rest)
      else if (!m[1]) {
        // Block form: id lines up to a closing `:::`; never runs past a fence or another directive.
        const body: string[] = []
        let j = i + 1
        while (
          j < lines.length &&
          !CLOSE_RE.test(lines[j]) &&
          !FENCE_RE.test(lines[j]) &&
          !OPEN_RE.test(lines[j])
        )
          body.push(lines[j++])
        if (j < lines.length && CLOSE_RE.test(lines[j])) {
          ids = parseIds(body.join(' '))
          end = j
        }
      }
    }
    if (!ids) {
      text.push(line)
      continue
    }
    flush()
    out.push({ type: 'refs', ids })
    i = end
  }
  flush()
  return out
}
