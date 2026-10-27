import {
  Boxes,
  CheckSquare,
  GitBranch,
  LayoutDashboard,
  Play,
  Plug,
  Settings,
  ShoppingCart,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Module is listed in navigation but not built in this phase. */
  comingSoon?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/workflows', label: 'Workflows', icon: GitBranch },
  { to: '/executions', label: 'Executions', icon: Play },
  { to: '/approvals', label: 'Approvals', icon: CheckSquare },
  { to: '/integrations', label: 'Integrations', icon: Plug },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/inventory', label: 'Inventory', icon: Boxes, comingSoon: true },
  { to: '/settings', label: 'Settings', icon: Settings },
]
