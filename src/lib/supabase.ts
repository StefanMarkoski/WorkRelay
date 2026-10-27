import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

// The anon key is public by design; all authorization is enforced by RLS and Edge Functions.
export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'not-configured')

/** Turn Postgres/PostgREST errors into messages that are safe to show. */
export function errorMessage(error: unknown): string {
  const msg = (error as { message?: string } | null)?.message ?? ''
  if (/forbidden|permission denied|row-level security/i.test(msg)) return 'You do not have permission to do that.'
  if (/user_not_found/.test(msg)) return 'No WorkRelay user exists with that email. Ask them to sign up first.'
  if (/at least one owner/.test(msg)) return 'An organization must keep at least one owner.'
  if (/already decided/.test(msg)) return 'This request has already been decided.'
  return msg && msg.length < 200 ? msg : 'Something went wrong. Please try again.'
}
