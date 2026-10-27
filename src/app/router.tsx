import { Navigate, createHashRouter } from 'react-router-dom'
import { AppShell } from '@/components/layout/app-shell'
import { ModulePage } from '@/pages/module-placeholder'
import { AdminTenantsPage } from '@/pages/admin-tenants-page'
import { ApprovalsPage } from '@/pages/approvals-page'
import { ExecutionDetailPage } from '@/pages/execution-detail-page'
import { ExecutionsPage } from '@/pages/executions-page'
import { IntegrationsPage } from '@/pages/integrations-page'
import { OrderDetailPage } from '@/pages/order-detail-page'
import { OrdersPage } from '@/pages/orders-page'
import { OverviewPage } from '@/pages/overview-page'
import { SettingsPage } from '@/pages/settings-page'
import { WorkflowEditorPage } from '@/pages/workflow-editor-page'
import { WorkflowsPage } from '@/pages/workflows-page'

export const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'workflows', element: <WorkflowsPage /> },
      { path: 'workflows/:id', element: <WorkflowEditorPage /> },
      { path: 'executions', element: <ExecutionsPage /> },
      { path: 'executions/:id', element: <ExecutionDetailPage /> },
      { path: 'approvals', element: <ApprovalsPage /> },
      { path: 'integrations', element: <IntegrationsPage /> },
      { path: 'orders', element: <OrdersPage /> },
      { path: 'orders/:id', element: <OrderDetailPage /> },
      { path: 'inventory', element: <ModulePage title="Inventory" description="Planned for a future phase. Nothing to configure yet." /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'admin/tenants', element: <AdminTenantsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
