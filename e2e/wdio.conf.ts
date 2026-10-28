import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createWorld, destroyWorld } from './world.js'
import type { World } from './world.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const appBinaryPath = path.resolve(here, '../src-tauri/target/debug/bd-board')

/**
 * Pinned away from the 4445 default: other Tauri apps on this machine run their
 * own embedded WebDriver servers, and the client attaches to whichever process
 * already owns the port — silently driving the wrong app.
 */
const EMBEDDED_PORT = 4472

// The service resolves its direct-eval channel from this env var (default 4445),
// independently of `embeddedPort`; leaving them out of sync makes the poller
// talk to whatever app owns 4445.
process.env.TAURI_WEBDRIVER_PORT ??= String(EMBEDDED_PORT)

let world: World | undefined
let realHome: string | undefined

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./specs/native/**/*.e2e.ts'],
  maxInstances: 1,

  services: [
    [
      'tauri',
      {
        appBinaryPath,
        driverProvider: 'embedded',
        embeddedPort: EMBEDDED_PORT,
        captureBackendLogs: true,
        captureFrontendLogs: true,
      },
    ],
  ],

  capabilities: [
    {
      browserName: 'tauri',
      'wdio:tauriServiceOptions': {
        appBinaryPath,
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
  mochaOpts: {
    ui: 'bdd',
    timeout: 90000,
  },

  /**
   * The app reads its project registry from $HOME. Point it at a throwaway one (real
   * `bd init` projects) so the suite never reads or writes the real registry. The
   * launcher's HOME is restored in onComplete; workers and the app inherit this one.
   */
  onPrepare: () => {
    world = createWorld()
    realHome = process.env.HOME
    process.env.E2E_WORLD = JSON.stringify(world)
    process.env.HOME = world.home
  },

  onComplete: () => {
    if (realHome !== undefined) process.env.HOME = realHome
    if (world) destroyWorld(world)
  },

  /**
   * Fail loudly when the session attached to another Tauri app: without this the
   * suite silently exercises whatever app owns the WebDriver port.
   */
  before: async () => {
    const title = await browser.getTitle()
    if (!title.includes('bd')) {
      throw new Error(
        `attached to the wrong app (title: "${title}") — is another Tauri WebDriver session running?`,
      )
    }
  },
}
