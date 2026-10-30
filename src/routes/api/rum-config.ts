import { createFileRoute } from '@tanstack/react-router'
import { rumConfigResponse } from '@/lib/rum-config-server'

export const Route = createFileRoute('/api/rum-config')({
  server: {
    handlers: {
      GET: () =>
        Response.json(rumConfigResponse(), {
          headers: { 'Cache-Control': 'no-store' },
        }),
    },
  },
})
