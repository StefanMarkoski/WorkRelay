import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme, type ThemePreference } from './theme-provider'

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

export function ThemeSwitcher() {
  const { preference, setPreference } = useTheme()
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex gap-1 rounded-lg border bg-card p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          aria-label={label}
          title={label}
          onClick={() => setPreference(value)}
          className={cn(
            'rounded px-2 py-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
            preference === value && 'bg-secondary text-accent-foreground',
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  )
}
