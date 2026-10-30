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
