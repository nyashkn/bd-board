import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { rumConfigResponse, readServerRumConfig } from './rum-config-server.ts'
import { viewName } from './rum-views.ts'

describe('server rum config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rum-'))
  const file = path.join(dir, 'rum.json')

  it('is disabled with no file and no env', () => {
    expect(rumConfigResponse(readServerRumConfig({}, file))).toEqual({
      enabled: false,
    })
  })

  it('file enables, env overrides, response is normalized and drops unknown keys', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        enabled: true,
        site: 'a.example.com',
        organizationIdentifier: 'kn',
        clientToken: 't',
        junk: 'x',
      }),
    )
    const out = rumConfigResponse(
      readServerRumConfig(
        { O2_RUM_PROFILE: 'minimal', BD_BOARD_AUTHOR: 'kn' },
        file,
      ),
    )
    expect(out).toMatchObject({
      enabled: true,
      site: 'a.example.com',
      profile: 'minimal',
      userName: 'kn',
    })
    expect(out).not.toHaveProperty('junk')
  })

  it('a malformed file or invalid values give disabled', () => {
    fs.writeFileSync(file, '{nope')
    expect(rumConfigResponse(readServerRumConfig({}, file))).toEqual({
      enabled: false,
    })
    fs.writeFileSync(file, JSON.stringify({ enabled: true, site: 'https://x' }))
    expect(rumConfigResponse(readServerRumConfig({}, file))).toEqual({
      enabled: false,
    })
  })
})

describe('viewName', () => {
  it('has no ids in it', () => {
    expect(viewName('/', {})).toBe('projects')
    expect(viewName('/p/demo', {})).toBe('board')
    expect(viewName('/p/demo', { tab: 'knowledge' })).toBe('knowledge')
    expect(viewName('/p/demo', { tab: 'hierarchy', bead: 'x-1' })).toBe(
      'bead-modal',
    )
  })
})
