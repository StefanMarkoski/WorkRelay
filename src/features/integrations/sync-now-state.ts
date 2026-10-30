import { formatDateTime } from '@/lib/format'
import type { IntegrationSync } from '@/types/db'

export type SyncNowState =
  | { available: true; callsLeft: number; total: number; resetsAt: Date | null }
  | { available: false; reason: string }

type Sync = Pick<IntegrationSync, 'source_url' | 'calls' | 'days' | 'paused' | 'window_start' | 'window_used'>

const DAY = 86_400_000

/**
 * Whether "Sync now" can be pressed for a shop, and if not, why, in words the person can act on. This mirrors the rules the
 * database enforces (it is the authority; this only saves a doomed click and explains the gate). A manual call is one of the
 * shop's scheduled calls: it needs a schedule set by the platform admin, the products URL, no pause, and calls left.
 */
export function syncNowState(sync: Sync | null | undefined, now: number): SyncNowState {
  if (!sync || sync.calls === null || sync.days === null) {
    return { available: false, reason: 'WorkRelay has not set up scheduled checks for this shop yet. Ask WorkRelay to set them up.' }
  }
  if (!sync.source_url) return { available: false, reason: 'Add the products URL first (Settings → API Calls).' }
  if (sync.paused) return { available: false, reason: 'Checks for this shop are paused. Turn the pause off under Settings → API Calls.' }

  const start = sync.window_start ? Date.parse(sync.window_start) : null
  const renewsAt = start === null ? null : start + sync.days * DAY
  const expired = start === null || (renewsAt !== null && now >= renewsAt)
  const used = expired ? 0 : sync.window_used
  const callsLeft = Math.max(0, sync.calls - used)
  if (callsLeft === 0) {
    return { available: false, reason: `This shop has used all ${sync.calls} of its calls for now. They renew ${renewsAt ? `on ${formatDateTime(new Date(renewsAt).toISOString())}` : 'automatically'}.` }
  }
  return { available: true, callsLeft, total: sync.calls, resetsAt: expired || renewsAt === null ? null : new Date(renewsAt) }
}

/** "11 of 15 calls left", in the unit the budget is set in. */
export function callsLeftText(state: Extract<SyncNowState, { available: true }>, days: number): string {
  return `${state.callsLeft} of ${state.total} calls left${days === 1 ? ' today' : ` this ${days}-day period`}`
}
