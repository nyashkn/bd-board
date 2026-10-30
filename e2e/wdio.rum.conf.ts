import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { startIngest } from './rum-ingest.js'
import { config as fixture } from './wdio.fixture.conf.js'
import type { Ingest } from './rum-ingest.js'

let ingest: Ingest | undefined

/**
 * RUM suite: the fixture dev server plus a fake OpenObserve intake on 127.0.0.1. The specs
 * switch RUM on and off by rewriting rum.json in the throwaway HOME (the app reads it per
 * request), so one server covers every profile. Run with E2E_FIXTURE_PORT set to a free port.
 */
export const config: WebdriverIO.Config = {
  ...fixture,
  specs: ['./specs/rum/**/*.e2e.ts'],
  onPrepare: async (...args) => {
    ingest = await startIngest(
      path.join(mkdtempSync(path.join(tmpdir(), 'bdb-rum-')), 'ingest.jsonl'),
    )
    process.env.E2E_RUM_PORT = String(ingest.port)
    process.env.E2E_RUM_LOG = ingest.logPath
    await fixture.onPrepare?.(...args)
  },
  onComplete: async (...args) => {
    await ingest?.close()
    await fixture.onComplete?.(...args)
  },
}
