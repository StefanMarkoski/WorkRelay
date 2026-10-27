import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
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

  const authHeader = req.headers.get('authorization') ?? ''
  const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: auth } = await user.auth.getUser()
  if (!auth.user) return reply(401, { error: 'unauthenticated' })

  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return reply(400, { error: 'invalid_payload' })

  // RLS: the caller can only read workflows in their own organizations.
  const { data: wf } = await user.from('workflows').select('id, draft_definition').eq('id', parsed.data.workflow_id).maybeSingle()
  if (!wf) return reply(404, { error: 'not_found' })

  const result = validateDefinition(wf.draft_definition)
  if (!result.ok) return reply(422, { error: 'invalid_definition', issues: result.issues })

  const { data, error } = await admin.rpc('publish_workflow', {
    p_workflow: wf.id,
    p_definition: result.value,
    p_user: auth.user.id,
  })
  if (error) return reply(error.code === '42501' ? 403 : 500, { error: error.code === '42501' ? 'forbidden' : 'internal_error' })
  return reply(200, { version_id: data })
})
