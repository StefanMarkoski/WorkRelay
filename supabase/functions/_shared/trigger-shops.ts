import type { WorkflowTrigger } from './workflow-schema.ts'

export interface ShopRow {
  id: string
  name: string
  status: 'awaiting_bind' | 'connected' | 'revoked'
  track_signups: boolean
}

/**
 * Checks the shops a trigger names against the workspace's shops, when publishing. Returns a message to show, or null.
 *  - every named shop must belong to the workspace and not be disconnected;
 *  - a signup trigger needs customer signups switched on for every shop it names, or, if it names none (all shops),
 *    for at least one connected shop. Otherwise it could never run.
 */
export function checkTriggerShops(trigger: WorkflowTrigger, shops: ShopRow[]): string | null {
  let ids: string[] | undefined
  if ('integration_ids' in trigger && trigger.integration_ids?.length) ids = trigger.integration_ids
  else if (trigger.type === 'customer_signup' && trigger.integration_id) ids = [trigger.integration_id]
  if (trigger.type === 'webhook' || trigger.type === 'manual') return null

  const byId = new Map(shops.map((s) => [s.id, s]))
  for (const id of ids ?? []) {
    const shop = byId.get(id)
    if (!shop) return 'One of the chosen shops does not belong to this workspace.'
    if (shop.status === 'revoked') return `${shop.name} is disconnected. Untick it or reconnect the shop.`
  }

  if (trigger.type === 'customer_signup') {
    const off = (ids ?? []).map((id) => byId.get(id)!).filter((s) => !s.track_signups)
    if (off.length) return `Customer signups are off for ${off.map((s) => s.name).join(', ')}. Switch them on under Integrations first.`
    if (!ids && !shops.some((s) => s.status === 'connected' && s.track_signups)) {
      return 'Turn on customer signups for a shop first (Integrations, then Edit on the shop).'
    }
  }
  return null
}
