import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'

import { isDesktopApp } from '@/lib/server'
import { startRum, rumDuration, rumNow, rumView } from '@/lib/rum'
import { APP_VERSION, loadRumConfig, loadRumSdk } from '@/lib/rum-client'
import { viewName } from '@/lib/rum-views'

/**
 * Client-only. Starts RUM after first paint (so LCP is untouched) and reports route changes as
 * views plus a transition timing. Does nothing observable when no config enables RUM.
 */
export function useRum(): void {
  const router = useRouter()

  useEffect(() => {
    const desktop = isDesktopApp()
    let last = ''
    let t0 = 0
    const current = () => {
      const { pathname, search } = router.state.location
      return viewName(pathname, search as { tab?: unknown; bead?: unknown })
    }
    const report = () => {
      const name = current()
      if (t0) rumDuration('route.transition', t0, { view: name })
      t0 = 0
      if (name === last) return
      last = name
      rumView(name)
    }
    const offBefore = router.subscribe('onBeforeNavigate', () => {
      t0 = rumNow()
    })
    const offResolved = router.subscribe('onResolved', report)
    report()

    const start = () =>
      void startRum({
        desktop,
        version: APP_VERSION,
        loadConfig: () => loadRumConfig(desktop),
        loadSdk: loadRumSdk,
      })
    const idle =
      window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200))
    // two frames: past the first paint, then idle
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => idle(start)),
    )
    return () => {
      cancelAnimationFrame(raf)
      offBefore()
      offResolved()
    }
  }, [router])
}
