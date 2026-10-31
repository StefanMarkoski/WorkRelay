import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

/**
 * The kinds of API call WorkRelay makes, as tabs. Today there is one: Inventory (WorkRelay asking a shop for its products and
 * stock). Naming the kind keeps the page from reading like a general API setting, and gives any later kind a place to go.
 * Each tab is a real route, so a link to one opens straight on it.
 */
const API_CALL_TABS = [{ to: '/api-calls/inventory', label: 'Inventory' }]

export function ApiCallsTabs() {
  return (
    <nav aria-label="Kinds of API call" className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b">
      {API_CALL_TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
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
