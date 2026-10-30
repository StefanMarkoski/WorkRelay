import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

const TABS = [
  { to: '/settings', label: 'General', end: true },
  { to: '/settings/api-calls', label: 'API Calls', end: false },
]

/** The Settings subpages. Each is a real route, so a link to one opens straight on it. */
export function SettingsTabs() {
  return (
    <nav aria-label="Settings sections" className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b">
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

/**
 * The kinds of API call WorkRelay makes. Today there is one: Inventory (WorkRelay asking a shop for its products and stock).
 * Naming the kind keeps this page from reading like a general API setting, and gives any later kind a place to go.
 */
const API_CALL_KINDS = [{ to: '/settings/api-calls/inventory', label: 'Inventory' }]

export function ApiCallsKinds() {
  return (
    <nav aria-label="Kinds of API call" className="mb-5 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">API calls for</span>
      {API_CALL_KINDS.map((k) => (
        <NavLink
          key={k.to}
          to={k.to}
          className={({ isActive }) =>
            cn(
              'rounded-md border px-3 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
            )
          }
        >
          {k.label}
        </NavLink>
      ))}
    </nav>
  )
}
