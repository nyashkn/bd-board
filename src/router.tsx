import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'
import { rumError } from './lib/rum'
import { getContext } from './integrations/tanstack-query/root-provider'

// Loaded only in e2e builds (VITE_WDIO=1): enables browser.tauri.execute(),
// command mocking and log capture for @wdio/tauri-service.
if (typeof window !== 'undefined' && import.meta.env.VITE_WDIO === '1') {
  void import('@wdio/tauri-plugin')
}

export function getRouter() {
  const context = getContext()

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultOnCatch: (error) => rumError(error, { boundary: 'router' }),
  })

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
