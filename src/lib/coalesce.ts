/**
 * Concurrent calls for one key share work: one runs, and callers that arrive meanwhile join a
 * single trailing run that starts when it ends. So a burst costs at most two runs, and no caller
 * gets a result that began before its call (a write may have landed in between).
 */
interface Slot<T> {
  running?: Promise<T>
  trailing?: Promise<T>
}

const slots = new Map<string, Slot<never>>()

export function coalesced<T>(key: string, build: () => Promise<T>): Promise<T> {
  const slot = (slots.get(key) ?? {}) as Slot<T>
  slots.set(key, slot as Slot<never>)
  const start = (): Promise<T> => {
    const run: Promise<T> = build().finally(() => {
      if (slot.running === run) slot.running = undefined
    })
    slot.running = run
    return run
  }
  if (slot.trailing) return slot.trailing
  if (!slot.running) return start()
  const settled = () => undefined
  const next = slot.running.then(settled, settled).then(() => {
    slot.trailing = undefined
    return start()
  })
  slot.trailing = next
  return next
}
