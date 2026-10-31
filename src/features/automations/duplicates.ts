/**
 * Automations that have exactly the same settings share a key (the database computes it; it is a hash, never the destination URL).
 * New duplicates are refused when they are saved, but ones made before that rule exist, and two that are both switched on send
 * every message twice. This finds them so the list can say so.
 */
export interface KeyedAutomation {
  id: string
  enabled: boolean
  preset_key: string | null
}

/**
 * For each automation that is switched on and has an identical twin that is also switched on: how many identical ones are on.
 * A twin that is switched off does not fire, so it is not a problem and is not reported.
 */
export function duplicatesThatFire(rows: KeyedAutomation[]): Map<string, number> {
  const on = new Map<string, string[]>()
  for (const r of rows) {
    if (!r.enabled || !r.preset_key) continue
    on.set(r.preset_key, [...(on.get(r.preset_key) ?? []), r.id])
  }
  const out = new Map<string, number>()
  for (const ids of on.values()) if (ids.length > 1) for (const id of ids) out.set(id, ids.length)
  return out
}
