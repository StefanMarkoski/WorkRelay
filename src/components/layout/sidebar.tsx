import { ShieldCheck } from 'lucide-react'
import { MotionConfig, motion } from 'motion/react'
import { NavLink } from 'react-router-dom'
import { useIsPlatformAdmin } from '@/features/admin/queries'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { cn } from '@/lib/utils'
import { NAV_ITEMS, type NavItem } from './nav-items'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'group relative flex items-center justify-between rounded-md px-3 py-2 text-[13px] font-medium text-muted-foreground outline-none transition-[color,background-color,transform] duration-150 hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]',
    isActive && 'text-foreground hover:bg-transparent hover:text-foreground',
  )

/** One highlight shared by all items: it glides from the old item to the new one (layout animation). */
const ActiveGlide = () => (
  <motion.span
    layoutId="nav-active"
    aria-hidden
    className="absolute inset-0 rounded-md bg-accent"
    transition={{ type: 'spring', stiffness: 520, damping: 38 }}
  />
)

const Label = ({ children }: { children: string }) => (
  <p className="px-2 pt-5 pb-1.5 font-mono text-[11px] tracking-wide text-muted-foreground uppercase first:pt-0">{children}</p>
)

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const isAdmin = useIsPlatformAdmin().data === true
  const { canManage } = useWorkspace()
  const visible = (g: NavItem['group']) => NAV_ITEMS.filter((i) => i.group === g && (!i.adminOnly || canManage))

  const item = ({ to, label, icon: Icon, comingSoon }: NavItem) => (
    <NavLink key={to} to={to} end={to === '/'} onClick={onNavigate} className={linkClass}>
      {({ isActive }) => (
        <>
          {isActive && <ActiveGlide />}
          <span className="relative flex items-center gap-3">
            <Icon className={cn('size-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:scale-110', isActive && 'text-primary')} />
            {label}
          </span>
          {comingSoon ? (
            <span className="relative rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">Soon</span>
          ) : (
            isActive && <motion.span aria-hidden initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.12, type: 'spring', stiffness: 500, damping: 20 }} className="relative size-1.5 rounded-full bg-primary" />
          )}
        </>
      )}
    </NavLink>
  )

  return (
    <MotionConfig reducedMotion="user">
    <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto p-4">
      <Label>Main menu</Label>
      {visible('main').map(item)}
      <Label>Management</Label>
      {visible('management').map(item)}
      {isAdmin && (
        <>
          <Label>Platform</Label>
          <NavLink to="/admin/tenants" onClick={onNavigate} className={linkClass}>
            {({ isActive }) => (
              <>
                {isActive && <ActiveGlide />}
                <span className="relative flex items-center gap-3">
                  <ShieldCheck className={cn('size-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:scale-110', isActive && 'text-primary')} />
                  Tenants
                </span>
              </>
            )}
          </NavLink>
        </>
      )}
    </nav>
    </MotionConfig>
  )
}
