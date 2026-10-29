/** Command palette query model: free words plus scope chips (`status:open`, `@ana`, ...). Pure. */

export type ChipKind = 'epic' | 'status' | 'label' | 'type' | 'assignee'

export interface Chip {
  kind: ChipKind
  value: string
}

export interface PaletteQuery {
  chips: Chip[]
  /** Lower-cased free words; every one must match. */
  words: string[]
}

export const MAX_QUERY_CHARS = 200
export const MAX_WORDS = 8

const KINDS = new Set(['epic', 'status', 'label', 'type'])

/** `kind:value` or `@name` -> chip; anything else (or an empty value) is a plain word. */
export function chipOf(token: string): Chip | null {
  if (token.startsWith('@')) {
    const value = token.slice(1)
    return value ? { kind: 'assignee', value } : null
  }
  const colon = token.indexOf(':')
  if (colon <= 0) return null
  const kind = token.slice(0, colon).toLowerCase()
  const value = token.slice(colon + 1)
  return KINDS.has(kind) && value ? { kind: kind as ChipKind, value } : null
}

export function chipLabel(chip: Chip): string {
  return chip.kind === 'assignee'
    ? `@${chip.value}`
    : `${chip.kind}:${chip.value}`
}

/**
 * Moves every finished chip token (one followed by whitespace) out of the input. The token
 * still being typed stays, so `status:op` is not a chip until the user hits space.
 */
export function commitChips(input: string): { chips: Chip[]; rest: string } {
  const parts = input.split(/(\s+)/) // tokens at even indexes, separators at odd
  const chips: Chip[] = []
  let rest = ''
  for (let i = 0; i < parts.length; i += 2) {
    const chip = i + 1 < parts.length ? chipOf(parts[i]) : null
    if (chip) chips.push(chip)
    else rest += parts[i] + (parts[i + 1] ?? '')
  }
  return { chips, rest }
}

/**
 * Committed chips plus the input. A chip-shaped token still being typed already narrows
 * results (as a live chip) so feedback is instant.
 */
export function buildQuery(chips: Chip[], input: string): PaletteQuery {
  const tokens = input.slice(0, MAX_QUERY_CHARS).split(/\s+/).filter(Boolean)
  const last = tokens.at(-1)
  const live = last && !/\s$/.test(input) ? chipOf(last) : null
  const all = [...chips]
  if (live) {
    all.push(live)
    tokens.pop()
  }
  const words: string[] = []
  for (const token of tokens) {
    const chip = chipOf(token)
    if (chip) all.push(chip)
    else if (words.length < MAX_WORDS) words.push(token.toLowerCase())
  }
  return { chips: all, words }
}

export function isEmptyQuery(q: PaletteQuery): boolean {
  return q.chips.length === 0 && q.words.length === 0
}
