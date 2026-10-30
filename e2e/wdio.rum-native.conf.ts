import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { startIngest } from './rum-ingest.js'
import { config as native } from './wdio.conf.js'
import type { Ingest } from './rum-ingest.js'

let ingest: Ingest | undefined

/**
 * Native RUM check: the real debug desktop build (E2E_APP_BINARY) with a rum.json in its
 * throwaway HOME pointing at a fake intake on 127.0.0.1. Asserts the webview sends a view.
 */
export const config: WebdriverIO.Config = {
  ...native,
  specs: ['./specs/rum-native/**/*.e2e.ts'],
  onPrepare: async (...args) => {
    ingest = await startIngest(
      path.join(mkdtempSync(path.join(tmpdir(), 'bdb-rum-')), 'ingest.jsonl'),
    )
    process.env.E2E_RUM_LOG = ingest.logPath
    await native.onPrepare?.(...args) // creates the world and points HOME at it
    const dir = path.join(process.env.HOME ?? '', '.config', 'bd-board')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, 'rum.json'),
      JSON.stringify({
        enabled: true,
        site: `127.0.0.1:${ingest.port}`,
        insecureHTTP: true,
        organizationIdentifier: 'kn',
        clientToken: 'e2e-not-a-real-token',
        env: 'e2e',
        profile: 'full',
        replaySampleRate: 0,
      }),
    )
  },
  onComplete: async (...args) => {
    await ingest?.close()
    await native.onComplete?.(...args)
  },
}
