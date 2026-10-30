import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getCaller } from '../_shared/auth.ts'
import { json } from '../_shared/keys.ts'
import { validateDefinition } from '../_shared/workflow-schema.ts'

const url = Deno.env.get('SUPABASE_URL')!
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const body = z.object({ workflow_id: z.uuid() })

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' })

  const caller = await getCaller(req, admin)
  if (!caller.ok) return reply(401, { error: 'unauthenticated', reason: caller.reason })

  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return reply(400, { error: 'invalid_payload' })

  const { data: wf } = await admin
    .from('workflows').select('id, organization_id, draft_definition').eq('id', parsed.data.workflow_id).maybeSingle()
  if (!wf) return reply(404, { error: 'not_found' })

  // Only owners and admins of the workflow's organization may publish (publish_workflow re-checks this).
  const { data: membership } = await admin
    .from('memberships').select('role').eq('organization_id', wf.organization_id).eq('user_id', caller.id).maybeSingle()
  if (!membership) return reply(404, { error: 'not_found' })
  if (membership.role !== 'owner' && membership.role !== 'admin') return reply(403, { error: 'forbidden' })

  const result = validateDefinition(wf.draft_definition)
  if (!result.ok) return reply(422, { error: 'invalid_definition', issues: result.issues })

  // "Customer signed up" only makes sense when a shop actually sends signups. Refuse it here, not just in the form.
  const trigger = result.value.trigger
  if (trigger.type === 'customer_signup') {
    let q = admin.from('integrations').select('id').eq('organization_id', wf.organization_id).eq('status', 'connected').eq('track_signups', true).limit(1)
    if (trigger.integration_id) q = q.eq('id', trigger.integration_id)
    const { data: shops } = await q
    if (!shops || shops.length === 0) {
      return reply(422, {
        error: 'invalid_definition',
        issues: [{ path: 'trigger', message: 'Turn on customer signups for a shop first (Integrations, then Edit on the shop).' }],
      })
    }
  }

  const { data, error } = await admin.rpc('publish_workflow', {
    p_workflow: wf.id,
    p_definition: result.value,
    p_user: caller.id,
  })
  if (error) return reply(error.code === '42501' ? 403 : 500, { error: error.code === '42501' ? 'forbidden' : 'internal_error' })
  return reply(200, { version_id: data })
})
