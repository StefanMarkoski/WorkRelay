import { Link } from 'react-router-dom'
import type { Integration } from '@/types/db'
import { eligibleShops, toggleShop, type ShopSelection } from './shops'

type Shop = Pick<Integration, 'id' | 'name' | 'status' | 'track_signups'>

const box = 'size-4 shrink-0 rounded border-input accent-[var(--primary)] disabled:opacity-50'

/**
 * "Which shops" for an automation. "All shops" covers shops connected later too; ticking every shop is the same thing.
 * For "a customer signs up" only shops that send signups can be ticked: the others are shown, greyed, with the reason.
 */
export function ShopPicker({ shops, event, value, onChange }: { shops: Shop[]; event: string; value: ShopSelection; onChange: (next: ShopSelection) => void }) {
  const eligible = eligibleShops(shops, event)
  const eligibleIds = new Set(eligible.map((s) => s.id))
  const signup = event === 'customer_signed_up'
  const notSending = signup ? shops.filter((s) => s.status === 'connected' && !s.track_signups) : []
  // Shops already ticked that can no longer be used (disconnected or removed) stay visible so they can be unticked.
  const stale = (value ?? []).filter((id) => !eligibleIds.has(id))

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Which shops</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className={box} checked={value === null} onChange={() => onChange(null)} />
        <span className="font-medium">All shops</span>
        <span className="text-xs text-muted-foreground">{signup ? 'including any that switch signups on later' : 'including shops connected later'}</span>
      </label>
      <div className="space-y-1.5 border-l pl-4">
        {eligible.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className={box} checked={value === null || value.includes(s.id)} onChange={() => onChange(toggleShop(value, s.id, eligible))} />
            <span className="[overflow-wrap:anywhere]">{s.name}</span>
          </label>
        ))}
        {stale.map((id) => (
          <label key={id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className={box} checked onChange={() => onChange(value!.filter((x) => x !== id))} />
            <span className="text-muted-foreground [overflow-wrap:anywhere]">{shops.find((s) => s.id === id)?.name ?? 'A removed shop'} (not available)</span>
          </label>
        ))}
        {notSending.map((s) => (
          <label key={s.id} className="flex items-start gap-2 text-sm text-muted-foreground">
            <input type="checkbox" className={`${box} mt-0.5`} disabled checked={false} readOnly />
            <span>
              <span className="[overflow-wrap:anywhere]">{s.name}</span>
              <span className="block text-xs">
                Signups are off for this shop.{' '}
                <Link to="/integrations" className="underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">Switch them on</Link>
              </span>
            </span>
          </label>
        ))}
      </div>
      {value !== null && value.length === 0 && <p role="alert" className="text-xs text-destructive">Pick at least one shop.</p>}
      {event === 'customer_first_order' && (
        <p className="text-xs text-muted-foreground">
          {value === null
            ? 'Fires once per customer, on their first order in the workspace.'
            : 'Fires once for each ticked shop, the first time a customer orders from it (even if they ordered elsewhere before).'}
        </p>
      )}
    </fieldset>
  )
}
