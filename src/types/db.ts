export type OrgRole = 'owner' | 'admin' | 'member'
export type RunStatus = 'pending' | 'running' | 'waiting_approval' | 'succeeded' | 'failed' | 'skipped'

export interface Integration {
  id: string
  organization_id: string
  kind: string
  name: string
  status: 'awaiting_bind' | 'connected' | 'revoked'
  key_prefix: string
  external_store_id: string | null
  external_base_url: string | null
  bound_at: string | null
  last_seen_at: string | null
  created_at: string
  /** The shop opted in to the optional customer-signup webhook. */
  track_signups: boolean
  signups_enabled_at: string | null
  /** The one currency this shop sells in. Null only for a shop with no orders yet that nobody has set. */
  currency: string | null
}

export interface WebhookEvent {
  id: string
  integration_id: string
  event_id: string
  event_type: string | null
  status: 'received' | 'processed' | 'ignored' | 'failed'
  error: string | null
  attempt_count: number
  received_at: string
  processed_at: string | null
}

export interface Workflow {
  id: string
  organization_id: string
  name: string
  description: string
  status: 'draft' | 'published'
  enabled: boolean
  draft_definition: unknown
  current_version_id: string | null
  created_at: string
  updated_at: string
}

export interface WorkflowVersion {
  id: string
  workflow_id: string
  version: number
  definition: unknown
  created_at: string
}

export interface WorkflowRun {
  id: string
  workflow_id: string
  version_id: string
  trigger_source: string
  event_id: string | null
  status: RunStatus
  attempt: number
  error: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  workflows?: { name: string } | null
  workflow_versions?: { version: number } | null
  /** What started the run. The shop is `order.integration_id` or, for customer events, `event.integration_id`. */
  context?: { order?: { integration_id?: string }; event?: { integration_id?: string } } | null
}

export interface StepRun {
  id: string
  step_key: string
  step_name: string | null
  step_type: string | null
  position: number
  status: RunStatus
  input: unknown
  output: unknown
  error: string | null
  attempt: number
  started_at: string | null
  finished_at: string | null
}

export interface Approval {
  id: string
  run_id: string | null
  step_key: string | null
  title: string
  context: Record<string, unknown>
  reviewer_user_id: string | null
  reviewer_role: OrgRole
  status: 'pending' | 'approved' | 'rejected'
  decided_by: string | null
  decided_at: string | null
  comment: string | null
  created_at: string
}

export interface Order {
  id: string
  integration_id: string
  external_id: string
  order_number: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  placed_at: string | null
  currency: string | null
  subtotal_minor: number | null
  discount_minor: number | null
  shipping_minor: number | null
  tax_minor: number | null
  total_minor: number | null
  status: string
  payment_status: string
  fulfillment_status: string
  external_status: string | null
  external_payment_status: string | null
  external_fulfillment_status: string | null
  billing_address: Record<string, string | null> | null
  shipping_address: Record<string, string | null> | null
  notes: string | null
  data_quality: string[]
  last_event_at: string
  created_at: string
  updated_at: string
  integrations?: { name: string; currency?: string | null } | null
}

/** A row of list_customers: who they are, plus counts computed from their orders. */
export interface Customer {
  id: string
  name: string | null
  email: string
  phone: string | null
  first_seen_at: string
  /** Null for someone who signed up and has not ordered. */
  last_order_at: string | null
  order_count: number
  /** Order value per currency in minor units, cancelled orders left out. */
  spent: Record<string, number>
  /** When the shop reported their signup; null if it never did. */
  registered_at: string | null
  /** The shop's own customer id, informational only. */
  external_id: string | null
  total_count: number
}

/** A row of customer_orders. */
export interface CustomerOrder {
  id: string
  order_number: string | null
  external_id: string
  placed_at: string
  status: string
  payment_status: string
  fulfillment_status: string
  currency: string | null
  total_minor: number | null
  integration_name: string | null
  total_count: number
}

export interface OrderItem {
  id: string
  position: number
  external_id: string | null
  sku: string | null
  name: string | null
  quantity: number | null
  unit_price_minor: number | null
}

export interface OrderEvent {
  id: string
  source: 'external' | 'workrelay'
  type: string
  occurred_at: string
  actor_user_id: string | null
  data: Record<string, unknown>
}

export interface Member {
  user_id: string
  email: string
  role: OrgRole
  created_at: string
}

/** A row of list_products. */
export interface Product {
  id: string
  integration_id: string
  integration_name: string
  sku: string
  name: string
  /** Null: the shop never reported it. */
  stock: number | null
  /** The shop's own threshold. */
  notify_on: number | null
  /** Set by hand in the app; wins over the shop's value. */
  notify_on_override: number | null
  /** The override if set, else the shop's value; null means this product never alerts. */
  effective_notify_on: number | null
  price_minor: number | null
  currency: string | null
  price_source: 'api' | 'orders' | null
  unit: string | null
  category: string | null
  barcode: string | null
  reported_at: string | null
  sold_30d: number
  /** Stock is known, a threshold exists, and stock is at or below it. */
  low: boolean
  total_count: number
}

/** A row of product_orders. */
export interface ProductOrder {
  id: string
  order_number: string | null
  external_id: string
  placed_at: string | null
  status: string
  quantity: number
  unit_price_minor: number | null
  currency: string | null
  total_count: number
}

export interface StockEvent {
  id: string
  stock_before: number | null
  stock_after: number
  source: 'push' | 'pull'
  occurred_at: string
}

/** How WorkRelay talks to a shop to read its products. The rate (calls per days) is set by a platform admin only. */
export interface IntegrationSync {
  integration_id: string
  source_url: string | null
  /** Whether an Authorization value is stored; the value itself can never be read back. */
  has_auth_header: boolean
  push_enabled: boolean
  paused: boolean
  calls: number | null
  days: number | null
  next_sync_at: string | null
  last_sync_at: string | null
  last_error: string | null
}

/** A row of admin_list_tenant_shops. */
export interface TenantShop {
  id: string
  name: string
  status: string
  currency: string | null
  calls: number | null
  days: number | null
  last_sync_at: string | null
  last_error: string | null
}

/** A row of product_siblings: the same SKU in another shop of the workspace. */
export interface ProductSibling {
  id: string
  integration_id: string
  integration_name: string
  stock: number | null
  unit: string | null
  reported_at: string | null
  low: boolean
}
