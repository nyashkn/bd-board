export type CopyState = 'idle' | 'copied' | 'failed'

/** Writes to the clipboard; falls back to execCommand where the async API is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

/** Copies, reports `copied` or `failed`, and returns to `idle` after `ms`. */
export async function copyWithFeedback(
  text: string,
  set: (s: CopyState) => void,
  copy: (t: string) => Promise<boolean> = copyText,
  ms = 2000,
): Promise<void> {
  set((await copy(text).catch(() => false)) ? 'copied' : 'failed')
  setTimeout(() => set('idle'), ms)
}
