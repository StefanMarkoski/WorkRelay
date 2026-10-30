import { useId, type ComponentProps } from 'react'
import { Select } from '@/components/ui/input'
import { COMMON_CURRENCIES, currencyLabel, otherCurrencies } from '@/lib/currencies'

/**
 * One currency, chosen from a list: the usual ones first, then every other. A value that is not in either list (an odd
 * code already stored) is still shown, so a shop's current currency never disappears from its own form.
 */
export function CurrencySelect({ value, onChange, placeholder, ...rest }: Omit<ComponentProps<typeof Select>, 'value' | 'onChange'> & {
  value: string
  onChange: (code: string) => void
  /** Shown when nothing is chosen; leave out to require a choice without an empty option. */
  placeholder?: string
}) {
  const id = useId()
  const others = otherCurrencies()
  const known = new Set<string>([...COMMON_CURRENCIES, ...others])
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {value && !known.has(value) && <option value={value}>{value}</option>}
      <optgroup label="Common">
        {COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{currencyLabel(c)}</option>)}
      </optgroup>
      {others.length > 0 && (
        <optgroup label="All currencies">
          {others.map((c) => <option key={c} value={c}>{currencyLabel(c)}</option>)}
        </optgroup>
      )}
    </Select>
  )
}
