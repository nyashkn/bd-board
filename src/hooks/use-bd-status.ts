import { useQuery } from '@tanstack/react-query'

import { getBdStatusFn } from '@/lib/server'

/** Is bd runnable and new enough? Cheap, so cached for five minutes. */
export function useBdStatus() {
  return useQuery({
    queryKey: ['bd-status'],
    queryFn: () => getBdStatusFn(),
    staleTime: 5 * 60_000,
    retry: false,
  })
}
