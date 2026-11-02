import {
  BarChart3,
  Boxes,
  CheckSquare,
  LayoutDashboard,
  Play,
  Settings,
  ShoppingCart,
  Store,
  TriangleAlert,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  group: 'main' | 'automation' | 'shops' | 'management'
  /** Module is listed in navigation but not built in this phase. */
  comingSoon?: boolean
  /** Hidden from plain members (UI hint; the database enforces access). */
  adminOnly?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, group: 'main' },
  { to: '/insights', label: 'Insights', icon: BarChart3, group: 'main' },
  { to: '/orders', label: 'Orders', icon: ShoppingCart, group: 'main' },
  { to: '/customers', label: 'Customers', icon: Users, group: 'main' },
  { to: '/inventory', label: 'Inventory', icon: Boxes, group: 'main' },
  { to: '/automations', label: 'Automations', icon: Zap, group: 'automation', adminOnly: true },
  { to: '/executions', label: 'Executions', icon: Play, group: 'automation' },
  { to: '/approvals', label: 'Approvals', icon: CheckSquare, group: 'automation' },
  { to: '/shops', label: 'Shops', icon: Store, group: 'shops' },
  { to: '/failures', label: 'Failures', icon: TriangleAlert, group: 'shops' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'management' },
]
