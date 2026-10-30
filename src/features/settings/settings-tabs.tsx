import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

const TABS = [
  { to: '/settings', label: 'General', end: true },
  { to: '/settings/api-calls', label: 'API Calls', end: false },
]

/** The Settings subpages. Each is a real route, so a link to one opens straight on it. */
export function SettingsTabs() {
  return (
    <nav aria-label="Settings sections" className="mb-6 flex gap-1 overflow-x-auto border-b">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
