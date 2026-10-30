import { describe, expect, it } from 'vitest'

import { configFromEnv, mergeConfig, parseRumConfig } from './rum-config.ts'

const valid = {
  enabled: true,
  site: 'o2.example.com',
  organizationIdentifier: 'kn',
  clientToken: 'tok',
  env: 'production',
}

describe('parseRumConfig', () => {
  it('is off without enabled, with no warning state', () => {
    expect(parseRumConfig(undefined)).toEqual({ state: 'off' })
    expect(parseRumConfig({ ...valid, enabled: false })).toEqual({
      state: 'off',
    })
    expect(parseRumConfig({ site: 'x' })).toEqual({ state: 'off' })
  })

  it('accepts a minimal valid config with defaults (profile full, 100%)', () => {
    const r = parseRumConfig(valid)
    expect(r.state).toBe('on')
    if (r.state === 'on') {
      expect(r.config).toMatchObject({
        profile: 'full',
        sampleRate: 100,
        replaySampleRate: 100,
        insecureHTTP: false,
        site: 'o2.example.com',
        applicationName: 'bd-board',
      })
    }
  })

  it('reads string values from env-style input', () => {
    const r = parseRumConfig({
      ...valid,
      enabled: '1',
      insecureHTTP: 'true',
      sampleRate: '25',
      profile: 'minimal',
    })
    expect(r.state === 'on' && r.config).toMatchObject({
      insecureHTTP: true,
      sampleRate: 25,
      profile: 'minimal',
    })
  })

  it.each([
    [{ site: 'https://o2.example.com' }, 'site'],
    [{ site: 'o2.example.com/rum' }, 'site'],
    [{ site: '' }, 'site'],
    [{ clientToken: '' }, 'clientToken'],
    [{ organizationIdentifier: '' }, 'organizationIdentifier'],
    [{ profile: 'everything' }, 'profile'],
    [{ sampleRate: 150 }, 'sampleRate'],
    [{ replaySampleRate: 'lots' }, 'replaySampleRate'],
  ])('rejects %j without echoing values', (patch, field) => {
    const r = parseRumConfig({ ...valid, ...patch })
    expect(r.state).toBe('invalid')
    if (r.state === 'invalid') {
      expect(r.reason).toContain(field)
      expect(r.reason).not.toContain('tok')
    }
  })
})

describe('env mapping', () => {
  it('maps prefixed keys and lets defined values override', () => {
    const build = configFromEnv(
      { VITE_O2_RUM_SITE: 'a.example.com', VITE_O2_RUM_ENABLED: '1' },
      'VITE_O2_RUM_',
    )
    expect(build.site).toBe('a.example.com')
    const merged = mergeConfig(build, { site: 'b.example.com', env: undefined })
    expect(merged.site).toBe('b.example.com')
    expect(merged.enabled).toBe('1')
  })

  it('a runtime enabled:false switches a build-time enable off', () => {
    const merged = mergeConfig({ ...valid, enabled: '1' }, { enabled: false })
    expect(parseRumConfig(merged)).toEqual({ state: 'off' })
  })
})
