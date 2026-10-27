export type ThemePref = 'light' | 'dark' | 'system'

export const THEME_KEY = 'bd-board:theme'

export function parseTheme(value: unknown): ThemePref {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function resolveTheme(
  pref: ThemePref,
  prefersDark: boolean,
): 'light' | 'dark' {
  if (pref === 'system') return prefersDark ? 'dark' : 'light'
  return pref
}

/** Applies the class on <html>; shared by the head script and the toggle. */
export function applyTheme(pref: ThemePref): void {
  const dark = resolveTheme(
    pref,
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  document.documentElement.classList.toggle('dark', dark === 'dark')
}

export function loadTheme(): ThemePref {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY))
  } catch {
    return 'system'
  }
}

export function saveTheme(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, pref)
  } catch {
    // storage unavailable: the choice only lasts for this page
  }
}

/** Runs in <head> before first paint so the page never flashes the wrong theme. */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_KEY)});var d=p==='dark'||(p!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){if(window.matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}})()`
