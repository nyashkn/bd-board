/** Low-cardinality RUM view name for a route: never contains a project or bead id. */
export function viewName(
  pathname: string,
  search: { tab?: unknown; bead?: unknown },
): string {
  if (!pathname.startsWith('/p/')) return 'projects'
  if (typeof search.bead === 'string' && search.bead) return 'bead-modal'
  return typeof search.tab === 'string' && search.tab ? search.tab : 'board'
}
