import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { applyTheme, loadTheme, parseTheme, saveTheme } from '@/lib/theme'

import type { LucideIcon } from 'lucide-react'
import type { ThemePref } from '@/lib/theme'

const OPTIONS: { key: ThemePref; label: string; icon: LucideIcon }[] = [
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
  { key: 'system', label: 'System', icon: Monitor },
]

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>('system')

  useEffect(() => setPref(loadTheme()), [])

  // Follow the OS while the choice is "system".
  useEffect(() => {
    if (pref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  function choose(value: string) {
    if (!value) return
    const next = parseTheme(value)
    setPref(next)
    saveTheme(next)
    applyTheme(next)
  }

  return (
    <ToggleGroup
      type="single"
      value={pref}
      onValueChange={choose}
      aria-label="Theme"
    >
      {OPTIONS.map(({ key, label, icon: Icon }) => (
        <ToggleGroupItem
          key={key}
          value={key}
          aria-label={label}
          title={label}
          className="min-h-6 min-w-6 px-2"
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
