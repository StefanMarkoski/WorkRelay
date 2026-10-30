import { timeAgo } from '@/lib/format'
import type { IntegrationSync } from '@/types/db'

export interface Freshness {
  /** When the shop's products were last brought in, by either route. Null if never. */
  at: string | null
  /** `check`: WorkRelay asked the shop (scheduled or Sync now). `push`: the shop sent them. */
  how: 'check' | 'push' | null
  /** Who pressed the button in the shop's admin, when the shop said so. */
  by: string | null
}

type Sync = Pick<IntegrationSync, 'last_sync_at' | 'last_push_at' | 'last_push_by'>

/**
 * When a shop was last synced, whichever way it happened: WorkRelay's own check, or the shop pushing. The later one wins.
 * (Timestamps are compared as times, not as text, because the database may write them with different precision.)
 */
export function lastSynced(sync: Sync | null | undefined): Freshness {
  const check = sync?.last_sync_at ?? null
  const push = sync?.last_push_at ?? null
  if (!check && !push) return { at: null, how: null, by: null }
  if (push && (!check || Date.parse(push) >= Date.parse(check))) return { at: push, how: 'push', by: sync?.last_push_by ?? null }
  return { at: check, how: 'check', by: null }
}

/** "synced 12m ago, sent by Marko (Admin)", "synced 3h ago, checked by WorkRelay", or "not synced yet". */
export function freshnessText(f: Freshness): string {
  if (!f.at || !f.how) return 'not synced yet'
  const how = f.how === 'push' ? `sent by ${f.by ?? 'the shop'}` : 'checked by WorkRelay'
  return `synced ${timeAgo(f.at)}, ${how}`
}
