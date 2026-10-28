import { OUTSIDE_SECRET } from '../../world.js'
import { artifactRow, openApp, paneOf, world } from './helpers.js'

describe('artifacts panel (real server, real bd, real files)', () => {
  before(async () => {
    const w = world()
    await openApp(`/p/${w.art.id}?bead=${encodeURIComponent(w.art.bead)}`)
    try {
      await artifactRow('Notes md').waitForDisplayed({ timeout: 30000 })
    } catch (err) {
      console.log(
        'PAGE TEXT:',
        await browser.execute(() => document.body.innerText),
      )
      throw err
    }
  })

  it('renders the spec_id file as markdown', async () => {
    await artifactRow('Spec').click()
    await expect(paneOf('Spec').$('h1')).toHaveText('Spec heading')
  })

  it('renders a local .md as markdown', async () => {
    await artifactRow('Notes md').click()
    const pane = paneOf('Notes md')
    await expect(pane.$('h1')).toHaveText('Notes heading')
    await expect(pane.$('strong')).toHaveText('bold')
  })

  it('shows a local .html in a script-only sandbox that cannot reach the parent', async () => {
    const titleBefore = await browser.getTitle()
    await artifactRow('Page html').click()
    const frame = paneOf('Page html').$('iframe')
    await frame.waitForDisplayed()

    const tokens = ((await frame.getAttribute('sandbox')) ?? '')
      .split(/\s+/)
      .filter(Boolean)
    expect(tokens).toContain('allow-scripts')
    expect(tokens).not.toContain('allow-same-origin')
    expect(await frame.getAttribute('src')).toBeNull()

    // The page's own script ran (so the block is the sandbox, not a dead script)
    // and every attempt to touch the parent or storage failed.
    await browser.switchFrame(frame)
    const result = await $('#h')
    await browser.waitUntil(
      async () => (await result.getText()) !== 'sandbox-pending',
      {
        timeoutMsg: 'the sandboxed script never ran',
      },
    )
    expect(await result.getText()).toBe(
      'parent-blocked|top-blocked|storage-blocked',
    )
    await browser.switchFrame(null)

    // Parent unaffected: title untouched and the app is still there.
    expect(await browser.getTitle()).toBe(titleBefore)
    expect(await browser.getTitle()).not.toMatch(/HACKED|CHILD/)
    await expect(artifactRow('Notes md')).toBeDisplayed()
  })

  it('shows a .png as a loaded image', async () => {
    await artifactRow('Pic png').click()
    const img = paneOf('Pic png').$('img')
    await img.waitForDisplayed()
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => {
          const el = document.querySelector<HTMLImageElement>(
            'img[alt="Artifact"]',
          )
          return Boolean(el && el.complete && el.naturalWidth > 0)
        })) === true,
      { timeoutMsg: 'image never decoded' },
    )
  })

  it('shows the error row for a missing file', async () => {
    await artifactRow('Missing md').click()
    await expect(paneOf('Missing md').$('[role="alert"]')).toHaveText(
      expect.stringContaining('File not found'),
    )
  })

  it('refuses a path that escapes the project and never shows the file', async () => {
    await artifactRow('Escaping md').click()
    const alert = paneOf('Escaping md').$('[role="alert"]')
    await alert.waitForDisplayed()
    await expect(alert).toHaveText(
      expect.stringContaining('escapes the project'),
    )
    const body = await browser.execute(() => document.body.innerText)
    expect(body).not.toContain(OUTSIDE_SECRET)
  })

  it('links a remote URL with the remote chip, noopener, and never fetches it', async () => {
    const link = $('a[href="https://example.com/remote-doc"]')
    await expect(link).toBeDisplayed()
    expect(await link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(await link.getAttribute('target')).toBe('_blank')
    expect((await link.getText()).toLowerCase()).toContain('remote')

    const embedded = await browser.execute(() => ({
      frames: [...document.querySelectorAll('iframe')].filter((f) =>
        (f.getAttribute('src') ?? '').includes('example.com'),
      ).length,
      imgs: [...document.querySelectorAll('img')].filter((i) =>
        i.src.includes('example.com'),
      ).length,
      fetched: performance
        .getEntriesByType('resource')
        .filter((e) => e.name.includes('example.com')).length,
    }))
    expect(embedded).toEqual({ frames: 0, imgs: 0, fetched: 0 })
  })

  it('shows external_ref as a safe link', async () => {
    const ref = $('a[href="https://example.com/ticket/42"]')
    await expect(ref).toBeDisplayed()
    expect(await ref.getAttribute('rel')).toBe('noopener noreferrer')
    expect(await ref.getAttribute('target')).toBe('_blank')
  })
})
