import { describe, expect, it } from 'vitest'

import {
  bdNotFoundMessage,
  bdTooOldMessage,
  classifyBdVersion,
} from './bd-errors'

describe('bd setup errors', () => {
  it('not found names the minimum, the install command and BD_BIN', () => {
    const m = bdNotFoundMessage(['bd', '/opt/homebrew/bin/bd'], undefined)
    expect(m).toContain('bd not found (tried: bd, /opt/homebrew/bin/bd)')
    expect(m).toContain('1.3.0')
    expect(m).toContain('brew install beads')
    expect(m).toContain('BD_BIN')
    expect(m).toContain('now: unset')
  })

  it('shows the BD_BIN currently in effect', () => {
    expect(bdNotFoundMessage(['/x/bd'], '/x/bd')).toContain('now: /x/bd')
  })

  it('too old names the detected version and the minimum', () => {
    const m = bdTooOldMessage('bd version 1.2.9 (Homebrew)')
    expect(m).toContain('bd 1.2.9 is too old')
    expect(m).toContain('1.3.0')
    expect(m).toContain('BD_BIN')
  })

  it('classifies versions', () => {
    expect(classifyBdVersion('bd version 1.3.2 (Homebrew)')).toEqual({
      state: 'ok',
      version: '1.3.2',
    })
    expect(classifyBdVersion('bd version 1.2.0').state).toBe('too_old')
    expect(classifyBdVersion('weird').state).toBe('ok')
  })
})
