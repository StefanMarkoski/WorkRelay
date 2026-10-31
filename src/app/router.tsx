import { Navigate, createHashRouter } from 'react-router-dom'
import { AppShell } from '@/components/layout/app-shell'
import { AutomationsPage } from '@/pages/automations-page'
import { AdminTenantsPage } from '@/pages/admin-tenants-page'
import { ApprovalsPage } from '@/pages/approvals-page'
import { CustomerDetailPage } from '@/pages/customer-detail-page'
import { CustomersPage } from '@/pages/customers-page'
import { ExecutionDetailPage } from '@/pages/execution-detail-page'
import { ExecutionsPage } from '@/pages/executions-page'
import { FailuresPage } from '@/pages/failures-page'
import { InsightsPage } from '@/pages/insights-page'
import { InventoryPage } from '@/pages/inventory-page'
import { IntegrationsPage } from '@/pages/integrations-page'
import { ProductDetailPage } from '@/pages/product-detail-page'
import { SyncHistoryPage } from '@/pages/sync-history-page'
import { OrderDetailPage } from '@/pages/order-detail-page'
import { OrdersPage } from '@/pages/orders-page'
import { OverviewPage } from '@/pages/overview-page'
import { SettingsApiCallsPage } from '@/pages/settings-api-calls-page'
import { SettingsPage } from '@/pages/settings-page'

export const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'automations', element: <AutomationsPage /> },
      { path: 'workflows', element: <Navigate to="/automations" replace /> },
      { path: 'executions', element: <ExecutionsPage /> },
      { path: 'executions/:id', element: <ExecutionDetailPage /> },
      { path: 'approvals', element: <ApprovalsPage /> },
      { path: 'failures', element: <FailuresPage /> },
      { path: 'integrations', element: <IntegrationsPage /> },
      { path: 'orders', element: <OrdersPage /> },
      { path: 'orders/:id', element: <OrderDetailPage /> },
      { path: 'insights', element: <InsightsPage /> },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'customers/:id', element: <CustomerDetailPage /> },
      { path: 'inventory', element: <InventoryPage /> },
      { path: 'inventory/syncs', element: <SyncHistoryPage /> },
      { path: 'inventory/:id', element: <ProductDetailPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'settings/api-calls', element: <Navigate to="/settings/api-calls/inventory" replace /> },
      { path: 'settings/api-calls/inventory', element: <SettingsApiCallsPage /> },
      { path: 'admin/tenants', element: <AdminTenantsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
