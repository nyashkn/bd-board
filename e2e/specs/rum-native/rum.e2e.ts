import { readFileSync } from 'node:fs'

interface Hit {
  url: string
  origin: string
  body: string
}

const hits = (): Hit[] =>
  readFileSync(process.env.E2E_RUM_LOG ?? '', 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Hit)

describe('desktop RUM (real webview, fake intake)', () => {
  it('sends a view event from the Tauri webview, reading rum_config from rum.json', async () => {
    await browser.waitUntil(
      async () => {
        await browser.execute(() => {
          Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
          })
          document.dispatchEvent(new Event('visibilitychange'))
        })
        return hits().some((h) => h.body.includes('"type":"view"'))
      },
      {
        timeout: 45000,
        interval: 1500,
        timeoutMsg: 'no view event reached the intake',
      },
    )
    const sent = hits()
    // The origin the desktop webview presents: the owner must allow it in the intake's CORS list.
    console.log(
      `RUM-DESKTOP-ORIGIN ${[...new Set(sent.map((h) => h.origin))].join(',')}`,
    )
    expect(sent.some((h) => h.body.includes('bd-board-desktop'))).toBe(true)
  })
})
