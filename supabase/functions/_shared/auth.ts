import type { SupabaseClient } from '@supabase/supabase-js'

export type Caller = { ok: true; id: string } | { ok: false; reason: string }

/**
 * Identify the signed-in user from the request's bearer token by asking the auth server to verify it.
 * Works with any admin (service-role) client; does not depend on a session or forwarded headers.
 */
export async function getCaller(req: Request, admin: SupabaseClient): Promise<Caller> {
  const match = /^Bearer (.+)$/i.exec(req.headers.get('authorization') ?? '')
  if (!match) return { ok: false, reason: 'missing bearer token' }
  const { data, error } = await admin.auth.getUser(match[1])
  if (error || !data.user) return { ok: false, reason: error?.message ?? 'token not accepted' }
  return { ok: true, id: data.user.id }
}
