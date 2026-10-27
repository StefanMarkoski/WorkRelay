import { createClient } from '@supabase/supabase-js'
import { createTenantSchema } from '../_shared/admin-schema.ts'
import { json } from '../_shared/keys.ts'
import { consoleLogger } from '../_shared/log.ts'

const url = Deno.env.get('SUPABASE_URL')!
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}
const reply = (status: number, b: Record<string, unknown>) => {
  const res = json(status, b)
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
  return res
}

/**
 * Creates a tenant: an auth user (email confirmed, password as typed by the platform admin) and its workspace.
 * Only platform admins may call it. The password is passed straight to the auth service and never logged or stored.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' })

  const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { authorization: req.headers.get('authorization') ?? '' } },
    auth: { persistSession: false },
  })
  const { data: auth } = await user.auth.getUser()
  if (!auth.user) return reply(401, { error: 'unauthenticated' })

  const { data: isAdmin } = await user.rpc('is_platform_admin')
  if (isAdmin !== true) return reply(403, { error: 'forbidden' })

  const parsed = createTenantSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    // Paths and messages only; never echo submitted values.
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    return reply(400, { error: 'invalid_payload', detail })
  }
  const { email, password, org_name } = parsed.data

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) {
    const taken = /already|registered|exists/i.test(created.error?.message ?? '')
    consoleLogger.info('tenant user creation failed', { reason: taken ? 'email_in_use' : 'auth_error' })
    return taken ? reply(409, { error: 'email_in_use' }) : reply(400, { error: 'user_creation_failed' })
  }
  const newUser = created.data.user

  const { data: orgId, error } = await admin.rpc('admin_create_tenant', {
    p_caller: auth.user.id,
    p_owner: newUser.id,
    p_org_name: org_name,
  })
  if (error) {
    // Do not leave an orphan login behind.
    await admin.auth.admin.deleteUser(newUser.id)
    consoleLogger.error('tenant creation failed', { message: error.message })
    return reply(500, { error: 'tenant_creation_failed' })
  }

  consoleLogger.info('tenant created', { organization_id: orgId, created_by: auth.user.id })
  return reply(200, { organization_id: orgId, user_id: newUser.id, email: newUser.email })
})
