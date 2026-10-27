import { AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useBdStatus } from '@/hooks/use-bd-status'

/** Dashboard diagnostic: only shown when bd is missing or older than the supported minimum. */
export function BdStatusCard() {
  const { data, refetch, isFetching } = useBdStatus()
  if (!data || data.state === 'ok') return null
  return (
    <Card
      role="alert"
      className="items-start gap-3 border-destructive/30 p-4"
      data-testid="bd-status-card"
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle
          className="mt-0.5 size-4 shrink-0 text-destructive"
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-medium">
            {data.state === 'missing' ? 'bd was not found' : 'bd is too old'}
          </p>
          <p className="text-xs break-words text-muted-foreground">
            {data.message}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={isFetching}
        onClick={() => refetch()}
      >
        {isFetching ? 'Checking...' : 'Check again'}
      </Button>
    </Card>
  )
}
