import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Markdown body style bound to the foreground token (not prose-invert), so it
 * has the same contrast as the rest of the UI in light and dark.
 */
export const PROSE_CLASS =
  'prose prose-sm max-w-none text-foreground prose-headings:scroll-mt-4 prose-pre:bg-muted prose-pre:text-xs ' +
  // Long words/URLs wrap; code blocks and tables scroll inside themselves, never the page.
  '[overflow-wrap:anywhere] prose-pre:overflow-x-auto prose-pre:[overflow-wrap:normal] [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto ' +
  '[--tw-prose-body:var(--foreground)] [--tw-prose-headings:var(--foreground)] [--tw-prose-lead:var(--foreground)] ' +
  '[--tw-prose-bold:var(--foreground)] [--tw-prose-counters:var(--muted-foreground)] [--tw-prose-bullets:var(--muted-foreground)] ' +
  '[--tw-prose-links:var(--primary-text)] [--tw-prose-code:var(--foreground)] [--tw-prose-quotes:var(--foreground)] ' +
  '[--tw-prose-quote-borders:var(--border-strong)] [--tw-prose-hr:var(--border-strong)] ' +
  '[--tw-prose-th-borders:var(--border-strong)] [--tw-prose-td-borders:var(--border)] ' +
  '[--tw-prose-pre-code:var(--foreground)]'

export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s_@.-]+/)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function toErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  return fallback
}
