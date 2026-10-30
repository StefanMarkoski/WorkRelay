import type { Integration } from '@/types/db'

type Shop = Pick<Integration, 'id' | 'name' | 'status' | 'track_signups'>

/** `null` means all shops, including ones connected later. A list means exactly those shops. */
export type ShopSelection = string[] | null

/** The shops an automation could cover. "A customer signs up" can only use shops that send signups. */
export function eligibleShops(shops: Shop[], event: string): Shop[] {
  return shops.filter((s) => s.status === 'connected' && (event !== 'customer_signed_up' || s.track_signups))
}

/** Ticking every shop that could be ticked is the same as "All shops". An empty list stays empty (it cannot be saved). */
export function normalizeSelection(selection: ShopSelection, eligible: Shop[]): ShopSelection {
  if (selection === null) return null
  const set = new Set(selection)
  return eligible.length > 0 && eligible.every((s) => set.has(s.id)) ? null : selection
}

/** Ticks or unticks one shop. From "All shops", unticking one leaves the rest. */
export function toggleShop(selection: ShopSelection, id: string, eligible: Shop[]): ShopSelection {
  const current = selection ?? eligible.map((s) => s.id)
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
  return normalizeSelection(next, eligible)
}

/** When the event changes, shops that no longer qualify (for example signups are off there) drop out. */
export function reconcileSelection(selection: ShopSelection, eligible: Shop[]): ShopSelection {
  if (selection === null) return null
  const ids = new Set(eligible.map((s) => s.id))
  return normalizeSelection(selection.filter((id) => ids.has(id)), eligible)
}

/** Up to two names, then "+N". */
const names = (list: string[]) => (list.length > 2 ? `${list.slice(0, 2).join(', ')} +${list.length - 2}` : list.join(', '))

/**
 * "All shops", or the chosen names ("Alpha, Beta" / "Alpha, Beta +2"). For "a customer signs up" on all shops it says
 * which shops are sending signups right now, because a shop with signups off silently drops out of "all".
 */
export function shopLabel(selection: ShopSelection, shops: Shop[], event?: string): string {
  if (selection === null) {
    if (event !== 'customer_signed_up') return 'All shops'
    const connected = shops.filter((s) => s.status === 'connected')
    const sending = connected.filter((s) => s.track_signups)
    if (sending.length === connected.length) return 'All shops'
    return sending.length === 0 ? 'All shops, none sending signups' : `Shops sending signups: ${names(sending.map((s) => s.name))}`
  }
  return names(selection.map((id) => shops.find((s) => s.id === id)?.name ?? 'a removed shop'))
}

/**
 * Whether a saved automation can currently run, and what to tell the owner about the shops it names.
 * `waiting`: none of its shops can trigger it. `notes`: named shops that cannot (the others still work).
 */
export function shopStatus(event: string, selection: ShopSelection, shops: Shop[]): { waiting: boolean; notes: string[] } {
  const signup = event === 'customer_signed_up'
  const named = selection === null ? shops.filter((s) => s.status === 'connected') : selection.map((id) => shops.find((s) => s.id === id) ?? null)
  const problem = (s: Shop | null): string | null =>
    !s ? 'a removed shop' : s.status !== 'connected' ? `${s.name} is disconnected` : signup && !s.track_signups ? `${s.name} has signups off` : null
  const working = named.filter((s) => s && problem(s) === null)
  // "All shops" is waiting only when no shop can trigger it, and only signups can be in that state. For signups it also
  // names the shops that are left out right now, since "all" quietly shrinks to the shops that send them.
  if (selection === null) {
    return { waiting: signup && working.length === 0, notes: signup ? named.map(problem).filter((p): p is string => p !== null) : [] }
  }
  return { waiting: working.length === 0, notes: working.length === named.length ? [] : named.map(problem).filter((p): p is string => p !== null) }
}
