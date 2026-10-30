import {
  Boxes,
  CheckSquare,
  LayoutDashboard,
  Play,
  Plug,
  Settings,
  ShoppingCart,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  group: 'main' | 'management'
  /** Module is listed in navigation but not built in this phase. */
  comingSoon?: boolean
  /** Hidden from plain members (UI hint; the database enforces access). */
  adminOnly?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, group: 'main' },
  { to: '/orders', label: 'Orders', icon: ShoppingCart, group: 'main' },
  { to: '/customers', label: 'Customers', icon: Users, group: 'main' },
  { to: '/automations', label: 'Automations', icon: Zap, group: 'main', adminOnly: true },
  { to: '/executions', label: 'Executions', icon: Play, group: 'main' },
  { to: '/approvals', label: 'Approvals', icon: CheckSquare, group: 'main' },
  { to: '/integrations', label: 'Integrations', icon: Plug, group: 'main' },
  { to: '/inventory', label: 'Inventory', icon: Boxes, group: 'management', comingSoon: true },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'management' },
]
