/** First `maxLines` non-blank lines of a description as plain text (markers stripped), capped at `maxChars`. */
export function descriptionExcerpt(
  text: string | undefined,
  maxLines = 3,
  maxChars = 240,
): string {
  const lines = (text ?? '')
    .split('\n')
    .map((l) =>
      l
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '')
        .replace(/[`*]/g, '')
        // Emphasis underscores only at word edges: snake_case and ids keep theirs.
        .replace(/(^|\W)_+|_+(?=\W|$)/g, '$1')
        .trim(),
    )
    .filter((l) => l && !/^(?:```|~~~|:::)/.test(l))
  const joined = lines.slice(0, maxLines).join('\n')
  const cut = joined.length > maxChars || lines.length > maxLines
  return cut ? `${joined.slice(0, maxChars).trimEnd()}…` : joined
}
