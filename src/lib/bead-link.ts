/** Search params for opening a bead on the current project route (`?bead=<id>`); drops any open knowledge entry. */
export function withBead<T extends object>(
  prev: T,
  id: string,
): T & { bead: string; k: undefined } {
  return { ...prev, bead: id, k: undefined }
}

/** True when the click asks for a new tab/window (Cmd/Ctrl/Shift/Alt or middle button). */
export function isModifiedClick(e: {
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  button: number
}): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0
}
