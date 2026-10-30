import { describe, expect, it } from 'vitest'

import { scrubEvent, stripQuery } from './rum-scrub.ts'

import type { ScrubEvent } from './rum-scrub.ts'

const viewEvent = (): ScrubEvent => ({
  type: 'view',
  view: {
    url: 'http://localhost:3009/p/demo?bead=demo-1&q=secret#x',
    referrer: 'http://localhost:3009/p/demo?q=old',
  },
  usr: { id: 'abc', name: 'kn' },
})
const click = (): ScrubEvent => ({
  type: 'action',
  action: { type: 'click', target: { name: 'Fix the payroll leak' } },
})
const custom = (): ScrubEvent => ({
  type: 'action',
  action: { type: 'custom', target: { name: 'palette.scope' } },
})

describe('stripQuery', () => {
  it('cuts at ? and #', () => {
    expect(stripQuery('/a/b?x=1#y')).toBe('/a/b')
    expect(stripQuery('/a#y')).toBe('/a')
    expect(stripQuery('/a')).toBe('/a')
  })
})

describe('scrubEvent', () => {
  it('full is a pass-through: output deep-equals input', () => {
    const events: ScrubEvent[] = [
      viewEvent(),
      click(),
      custom(),
      { type: 'error', error: { message: 'x'.repeat(500), stack: 's' } },
      {
        type: 'resource',
        resource: { url: '/_serverFn/x?payload=bead-9' },
        context: { ok: true, project: 'demo' },
      },
      { type: 'vital', context: { ok: true } },
    ]
    for (const e of events) {
      const before = structuredClone(e)
      expect(scrubEvent(e, 'full')).toBe(true)
      expect(e).toEqual(before)
    }
  })

  it.each(['full', 'standard', 'minimal'] as const)(
    '%s never keeps credential headers or the client token',
    (profile) => {
      const e: ScrubEvent = {
        type: 'resource',
        resource: {
          url: '/x?k=TOKEN123',
          request: { headers: { Authorization: 'Bearer a', accept: 'x' } },
          response: { headers: { 'Set-Cookie': 'a=b', 'content-type': 'y' } },
        },
        error: { message: 'bad TOKEN123', stack: 'at TOKEN123' },
      }
      scrubEvent(e, profile, ['TOKEN123'])
      expect(e.resource?.request?.headers).toEqual({ accept: 'x' })
      expect(e.resource?.response?.headers).toEqual({ 'content-type': 'y' })
      expect(JSON.stringify(e)).not.toContain('TOKEN123')
    },
  )

  it('full keeps URL with query, click target and user', () => {
    const v = viewEvent()
    expect(scrubEvent(v, 'full')).toBe(true)
    expect(v.view?.url).toContain('?bead=demo-1&q=secret')
    expect(v.usr).toBeDefined()
    const c = click()
    expect(scrubEvent(c, 'full')).toBe(true)
    expect(c.action?.target?.name).toBe('Fix the payroll leak')
  })

  it('standard strips queries, masks click text, drops user, caps errors', () => {
    const v = viewEvent()
    scrubEvent(v, 'standard')
    expect(v.view?.url).toBe('http://localhost:3009/p/demo')
    expect(v.view?.referrer).toBe('http://localhost:3009/p/demo')
    expect(v.usr).toBeUndefined()
    const c = click()
    expect(scrubEvent(c, 'standard')).toBe(true)
    expect(c.action?.target?.name).toBe('masked')
    const e: ScrubEvent = {
      type: 'error',
      error: { message: 'x'.repeat(500) },
    }
    scrubEvent(e, 'standard')
    expect(e.error?.message).toHaveLength(200)
    const r: ScrubEvent = {
      type: 'resource',
      resource: { url: '/_serverFn/x?payload=bead-9' },
    }
    scrubEvent(r, 'standard')
    expect(r.resource?.url).toBe('/_serverFn/x')
  })

  it('standard and minimal keep our own custom actions intact', () => {
    for (const profile of ['standard', 'minimal'] as const) {
      const a = custom()
      expect(scrubEvent(a, profile)).toBe(true)
      expect(a.action?.target?.name).toBe('palette.scope')
    }
  })

  it('minimal drops click events and the user, keeps views without query', () => {
    expect(scrubEvent(click(), 'minimal')).toBe(false)
    const v = viewEvent()
    expect(scrubEvent(v, 'minimal')).toBe(true)
    expect(v.usr).toBeUndefined()
    expect(v.view?.url).not.toContain('?')
  })
})
