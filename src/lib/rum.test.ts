import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  activateRum,
  flushKeystrokes,
  resetRumForTests,
  rumAction,
  rumDuration,
  rumKeystroke,
  rumMarkCold,
  rumNow,
  rumView,
  sdkInitConfig,
  startRum,
  tracked,
  turnRumOff,
} from './rum.ts'

import type { RumConfig } from './rum-config.ts'
import type { RumSdk } from './rum.ts'

const config = (over: Partial<RumConfig> = {}): RumConfig => ({
  site: '127.0.0.1:1',
  organizationIdentifier: 'kn',
  applicationName: 'bd-board',
  clientToken: 't',
  env: 'test',
  profile: 'full',
  insecureHTTP: true,
  sampleRate: 100,
  replaySampleRate: 100,
  ...over,
})

function fakeSdk() {
  const calls: { fn: string; args: unknown[] }[] = []
  const rec =
    (fn: string) =>
    (...args: unknown[]) => {
      calls.push({ fn, args })
    }
  const sdk: RumSdk = {
    init: rec('init'),
    startView: rec('startView'),
    addAction: rec('addAction'),
    addError: rec('addError'),
    addDurationVital: rec('addDurationVital'),
    setUser: rec('setUser'),
  }
  return { sdk, calls }
}

afterEach(() => resetRumForTests())

describe('init config', () => {
  it('full: replay on, text allowed, service by shell, version passed', () => {
    const c = sdkInitConfig({
      config: config(),
      desktop: false,
      version: '9.9.9',
    })
    expect(c).toMatchObject({
      service: 'bd-board-web',
      version: '9.9.9',
      sessionReplaySampleRate: 100,
      defaultPrivacyLevel: 'allow',
      trackViewsManually: true,
      apiVersion: 'v1',
    })
    expect(c.allowedTracingUrls).toBeUndefined()
  })

  it('standard/minimal: replay off, masked; desktop service name', () => {
    const c = sdkInitConfig({
      config: config({ profile: 'standard' }),
      desktop: true,
      version: '1',
    })
    expect(c).toMatchObject({
      service: 'bd-board-desktop',
      sessionReplaySampleRate: 0,
      defaultPrivacyLevel: 'mask-user-input',
      enablePrivacyForActionName: true,
      sessionPersistence: 'local-storage',
    })
    expect(
      sdkInitConfig({
        config: config({ profile: 'minimal' }),
        desktop: false,
        version: '1',
      }).trackUserInteractions,
    ).toBe(false)
  })
})

describe('queue and modes', () => {
  it('queues while pending and replays once active', () => {
    const { sdk, calls } = fakeSdk()
    rumAction('early', { n: 1 })
    activateRum({ config: config(), sdk, desktop: false, version: '1' })
    expect(calls.map((c) => c.fn)).toEqual(['init', 'addAction'])
  })

  it('off: nothing reaches the sdk, queue is dropped', () => {
    const { sdk, calls } = fakeSdk()
    rumAction('early')
    turnRumOff()
    rumAction('late')
    rumDuration('x', 0)
    expect(rumNow()).toBe(0)
    expect(calls).toEqual([])
    expect(sdk).toBeTruthy()
  })

  it('detail reaches the sdk in full only', () => {
    for (const profile of ['full', 'standard'] as const) {
      const { sdk, calls } = fakeSdk()
      resetRumForTests()
      activateRum({
        config: config({ profile }),
        sdk,
        desktop: false,
        version: '1',
      })
      rumAction('a', { ok: true }, { project: 'demo' })
      const ctx = calls.find((c) => c.fn === 'addAction')?.args[1]
      expect(ctx).toEqual(
        profile === 'full' ? { ok: true, project: 'demo' } : { ok: true },
      )
    }
  })

  it('startRum with an invalid config warns once and turns off; with off stays silent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const loadSdk = vi.fn()
    await startRum({
      desktop: false,
      version: '1',
      loadConfig: async () => ({
        state: 'invalid',
        reason: 'site must be host',
      }),
      loadSdk,
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(loadSdk).not.toHaveBeenCalled()
    resetRumForTests()
    warn.mockClear()
    await startRum({
      desktop: false,
      version: '1',
      loadConfig: async () => ({ state: 'off' }),
      loadSdk,
    })
    expect(warn).not.toHaveBeenCalled()
    expect(loadSdk).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('cold marks fire once per name', () => {
    const { sdk, calls } = fakeSdk()
    activateRum({ config: config(), sdk, desktop: false, version: '1' })
    rumMarkCold('cold.skeleton')
    rumMarkCold('cold.skeleton')
    expect(calls.filter((c) => c.fn === 'addDurationVital')).toHaveLength(1)
  })
})

describe('tracked', () => {
  it('records command, duration and status for ok and failing calls, never args or output', async () => {
    const { sdk, calls } = fakeSdk()
    activateRum({
      config: config({ profile: 'standard' }),
      sdk,
      desktop: false,
      version: '1',
    })
    const list = tracked('list', async (_a: { data: { project: string } }) => [
      'secret title',
    ])
    await list({ data: { project: 'demo' } })
    const bad = tracked('show', async () => {
      throw new Error('boom')
    })
    await expect(bad()).rejects.toThrow('boom')
    const vitals = calls.filter((c) => c.fn === 'addDurationVital')
    expect(vitals.map((v) => v.args[0])).toEqual([
      'bd.call.list',
      'bd.call.show',
    ])
    const opts = vitals.map(
      (v) => v.args[1] as { duration: number; context: object },
    )
    expect(opts[0].context).toEqual({ ok: true })
    expect(opts[1].context).toEqual({ ok: false })
    expect(JSON.stringify(vitals)).not.toContain('secret title')
    expect(JSON.stringify(vitals)).not.toContain('demo')
  })

  it('labels bd.call with the view that was current at call time', async () => {
    const { sdk, calls } = fakeSdk()
    activateRum({ config: config(), sdk, desktop: false, version: '1' })
    rumView('bead-modal')
    await tracked('show', async () => 1)()
    const ctx = (calls.at(-1)?.args[1] as { context: object }).context
    expect(ctx).toEqual({ ok: true, view: 'bead-modal' })
  })

  it('full adds the project name', async () => {
    const { sdk, calls } = fakeSdk()
    activateRum({ config: config(), sdk, desktop: false, version: '1' })
    await tracked(
      'list',
      async (_a: { data: { project: string } }) => 1,
    )({
      data: { project: 'demo' },
    })
    const ctx = (calls.at(-1)?.args[1] as { context: object }).context
    expect(ctx).toEqual({ ok: true, project: 'demo' })
  })

  it('off: passes straight through', async () => {
    turnRumOff()
    const fn = vi.fn(async (x: number) => x + 1)
    expect(await tracked('n', fn)(1)).toBe(2)
  })
})

describe('keystroke percentiles', () => {
  it('emits one p50 and one p95 for a burst', () => {
    const { sdk, calls } = fakeSdk()
    activateRum({ config: config(), sdk, desktop: false, version: '1' })
    for (let i = 1; i <= 20; i++) rumKeystroke(i)
    flushKeystrokes()
    const v = calls.filter((c) => c.fn === 'addDurationVital')
    expect(v.map((c) => c.args[0])).toEqual([
      'palette.search.p50',
      'palette.search.p95',
    ])
    expect((v[0].args[1] as { duration: number }).duration).toBe(11)
    expect((v[1].args[1] as { duration: number }).duration).toBe(20)
  })
})

describe('off-path overhead', () => {
  it('every hot-path call costs < 0.05 ms when off', () => {
    turnRumOff()
    const N = 200_000
    const t = performance.now()
    for (let i = 0; i < N; i++) {
      const t0 = rumNow()
      rumKeystroke(i)
      rumDuration('palette.open', t0)
      rumAction('palette.scope')
    }
    const perIteration = (performance.now() - t) / N
    expect(perIteration).toBeLessThan(0.05)
  })
})
