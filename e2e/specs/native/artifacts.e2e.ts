import { resetApp } from '../../helpers.js'
import type { World } from '../../world.js'

const world = JSON.parse(process.env.E2E_WORLD ?? 'null') as World | null

async function openBead(project: string, bead: string) {
  await resetApp('/')
  await browser.execute(
    (target: string) => window.location.replace(target),
    `/p/${project}?bead=${encodeURIComponent(bead)}`,
  )
  await $('[role="dialog"]').waitForDisplayed({ timeout: 30000 })
}

const row = (label: string) =>
  $(`//button[@data-slot="interactive-row" and contains(., "${label}")]`)

describe('artifacts through the Tauri read_artifact bridge', () => {
  before(() => {
    if (!world) throw new Error('E2E_WORLD missing; run through wdio.conf.ts')
  })

  it('reads a local .md and a sandboxed .html end to end', async () => {
    const w = world!
    await openBead(w.art.id, w.art.bead)

    await row('Notes md').click()
    await expect(
      $('//button[contains(., "Notes md")]/following-sibling::div[1]//h1'),
    ).toHaveText('Notes heading')

    await row('Page html').click()
    const frame = $(
      '//button[contains(., "Page html")]/following-sibling::div[1]//iframe',
    )
    await frame.waitForDisplayed()
    const sandbox = (await frame.getAttribute('sandbox')) ?? ''
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).not.toContain('allow-same-origin')

    await browser.switchFrame(frame)
    await browser.waitUntil(
      async () => (await $('#h').getText()) !== 'sandbox-pending',
      { timeoutMsg: 'sandboxed script never ran' },
    )
    expect(await $('#h').getText()).toBe(
      'parent-blocked|top-blocked|storage-blocked',
    )
    await browser.switchFrame(null)
  })

  it('refuses an escaping path through the bridge', async () => {
    await row('Escaping md').click()
    await expect(
      $(
        '//button[contains(., "Escaping md")]/following-sibling::div[1]//*[@role="alert"]',
      ),
    ).toHaveText(expect.stringContaining('escapes the project'))
  })

  it('shows the Read-only badge for a readonly project', async () => {
    const w = world!
    await resetApp('/')
    await browser.execute(
      (target: string) => window.location.replace(target),
      `/p/${w.ro.id}`,
    )
    await $('[data-bead-id]').waitForDisplayed({ timeout: 30000 })
    await expect($('*=Read-only')).toBeDisplayed()
    await expect($('button=New bead')).not.toExist()
  })
})
