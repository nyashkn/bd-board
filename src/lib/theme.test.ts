import { describe, expect, it } from 'vitest'

import { parseTheme, resolveTheme, THEME_INIT_SCRIPT } from './theme'

describe('theme', () => {
  it('parses stored values, defaulting to system', () => {
    expect(parseTheme('light')).toBe('light')
    expect(parseTheme('dark')).toBe('dark')
    expect(parseTheme('system')).toBe('system')
    expect(parseTheme('purple')).toBe('system')
    expect(parseTheme(null)).toBe('system')
  })

  it('resolves system from prefers-color-scheme', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('init script is valid JS', () => {
    expect(() => new Function(THEME_INIT_SCRIPT)).not.toThrow()
  })
})
