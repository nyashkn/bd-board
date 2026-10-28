import type { World } from '../../world.js'

export function world(): World {
  const raw = process.env.E2E_WORLD
  if (!raw)
    throw new Error('E2E_WORLD is not set; run through wdio.fixture.conf.ts')
  return JSON.parse(raw) as World
}

const BASE = process.env.E2E_DEV_SERVER_URL ?? 'http://localhost:3061'

/** Opens a path on the fixture dev server and waits for the app shell. */
export async function openApp(path: string): Promise<void> {
  await browser.url(`${BASE}${path}`)
  await $('aside button[aria-label]').waitForExist({ timeout: 30000 })
}

/** The artifact row (button) whose text contains `label`. */
export function artifactRow(label: string) {
  return $(`//button[@data-slot="interactive-row" and contains(., "${label}")]`)
}

/** The pane that opens right below an artifact row. */
export function paneOf(label: string) {
  return $(
    `//button[@data-slot="interactive-row" and contains(., "${label}")]/following-sibling::div[1]`,
  )
}
