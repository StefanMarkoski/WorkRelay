import { ShieldCheck } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useIsPlatformAdmin } from '@/features/admin/queries'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { cn } from '@/lib/utils'
import { NAV_ITEMS, type NavItem } from './nav-items'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center justify-between rounded-lg border border-transparent px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors outline-none hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
    isActive && 'border-primary/30 bg-primary/15 text-accent-foreground hover:bg-primary/15 hover:text-accent-foreground',
  )

const Label = ({ children }: { children: string }) => (
  <p className="px-2 pt-4 pb-1.5 text-xs font-medium text-muted-foreground/70 first:pt-0">{children}</p>
)

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const isAdmin = useIsPlatformAdmin().data === true
  const { canManage } = useWorkspace()
  const visible = (g: NavItem['group']) => NAV_ITEMS.filter((i) => i.group === g && (!i.adminOnly || canManage))

  const item = ({ to, label, icon: Icon, comingSoon }: NavItem) => (
    <NavLink key={to} to={to} end={to === '/'} onClick={onNavigate} className={linkClass}>
      {({ isActive }) => (
        <>
          <span className="flex items-center gap-3">
            <Icon className="size-4" />
            {label}
          </span>
          {comingSoon ? (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">Soon</span>
          ) : (
            isActive && <span aria-hidden className="size-1.5 rounded-full bg-primary" />
          )}
        </>
      )}
    </NavLink>
  )

  return (
    <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto p-4">
      <Label>Main menu</Label>
      {visible('main').map(item)}
      <Label>Management</Label>
      {visible('management').map(item)}
      {isAdmin && (
        <>
          <Label>Platform</Label>
          <NavLink to="/admin/tenants" onClick={onNavigate} className={linkClass}>
            <span className="flex items-center gap-3">
              <ShieldCheck className="size-4" />
              Tenants
            </span>
          </NavLink>
        </>
      )}
    </nav>
  )
}
