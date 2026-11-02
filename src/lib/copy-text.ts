export type CopyState = 'idle' | 'copied' | 'failed'

/** Writes to the clipboard; falls back to execCommand where the async API is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const active = document.activeElement as HTMLElement | null
    // Inside the open dialog: a modal dialog makes everything outside it inert, so the select would fail.
    const host = active?.closest('[role="dialog"]') ?? document.body
    const ta = document.createElement('textarea')
    try {
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      host.appendChild(ta)
      ta.select()
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      ta.remove()
      active?.focus()
    }
  }
}

/** Copies, reports `copied` or `failed`, and returns to `idle` after `ms`; a repeat restarts the timer. */
export async function copyWithFeedback(
  text: string,
  set: (s: CopyState) => void,
  timer: { current?: ReturnType<typeof setTimeout> },
  copy: (t: string) => Promise<boolean> = copyText,
  ms = 2000,
): Promise<void> {
  clearTimeout(timer.current)
  set((await copy(text).catch(() => false)) ? 'copied' : 'failed')
  clearTimeout(timer.current)
  timer.current = setTimeout(() => set('idle'), ms)
}
