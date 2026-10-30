import { Select } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import type { Integration } from '@/types/db'
import { RANGES, type RangeDays } from './series'

/** The date-range presets (no calendar to fight: nobody wants one for "the last 30 days"). */
export function RangeSegmented({ value, onChange, label = 'Time range' }: { value: RangeDays; onChange: (r: RangeDays) => void; label?: string }) {
  return (
    <Segmented
      label={label}
      value={String(value)}
      onChange={(v) => onChange(Number(v) as RangeDays)}
      options={RANGES.map((r) => ({ id: String(r), label: `${r} days` }))}
    />
  )
}

/** Hidden unless there is more than one shop to choose between. */
export function ShopSelect({ shops, value, onChange }: { shops: Pick<Integration, 'id' | 'name' | 'status'>[]; value: string; onChange: (id: string) => void }) {
  const usable = shops.filter((s) => s.status !== 'revoked')
  if (usable.length < 2) return null
  return (
    <Select aria-label="Shop" className="w-auto min-w-40" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All shops</option>
      {usable.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </Select>
  )
}
