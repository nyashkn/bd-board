import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createWorld, destroyWorld } from './world.js'
import type { World } from './world.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.E2E_FIXTURE_PORT ?? '3061'
const URL_BASE = `http://localhost:${PORT}`

let world: World | undefined
let server: ChildProcess | undefined

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(URL_BASE)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`fixture dev server did not come up on ${URL_BASE}`)
}

/**
 * Fixture-backed browser suite: Chrome against a REAL dev server (the real
 * server functions, real bd) whose HOME points at a throwaway registry.
 * No IPC stubs; the dev server is started and stopped here, on its own port.
 */
export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./specs/fixture/**/*.e2e.ts'],
  maxInstances: 1,

  capabilities: [
    {
      browserName: 'chrome',
      // one browser at a time: two chromedrivers race for the same port
      maxInstances: 1,
      'goog:chromeOptions': {
        args: ['--headless=new', '--window-size=1440,900'],
      },
    },
  ],

  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 15000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,

  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 90000 },

  onPrepare: async () => {
    world = createWorld()
    process.env.E2E_WORLD = JSON.stringify(world)
    process.env.E2E_DEV_SERVER_URL = URL_BASE
    server = spawn(
      path.resolve(here, '../node_modules/.bin/vite'),
      ['dev', '--port', PORT, '--strictPort'],
      {
        cwd: path.resolve(here, '..'),
        env: { ...process.env, HOME: world.home },
        stdio: 'ignore',
      },
    )
    await waitForServer()
  },

  onComplete: () => {
    // Only the process started above; never anything else on the machine.
    server?.kill('SIGTERM')
    if (world) destroyWorld(world)
  },
}
