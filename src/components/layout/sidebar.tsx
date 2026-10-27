import { ShieldCheck } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useIsPlatformAdmin } from '@/features/admin/queries'
import { cn } from '@/lib/utils'
import { NAV_ITEMS } from './nav-items'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const isAdmin = useIsPlatformAdmin().data === true
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="grid size-6 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          W
        </div>
        <span className="text-sm font-semibold tracking-tight">WorkRelay</span>
      </div>
      <nav aria-label="Main" className="flex-1 space-y-0.5 p-2">
        {NAV_ITEMS.map(({ to, label, icon: Icon, comingSoon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
                isActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
              )
            }
          >
            <Icon className="size-4" />
            <span className="flex-1">{label}</span>
            {comingSoon && (
              <span className="rounded border px-1 text-[10px] uppercase text-muted-foreground">Soon</span>
            )}
          </NavLink>
        ))}
        {isAdmin && (
          <>
            <p className="px-2.5 pt-4 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Platform</p>
            <NavLink
              to="/admin/tenants"
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
                  isActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
                )
              }
            >
              <ShieldCheck className="size-4" />
              <span className="flex-1">Tenants</span>
            </NavLink>
          </>
        )}
      </nav>
    </div>
  )
}
