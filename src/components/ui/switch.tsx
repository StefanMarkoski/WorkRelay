import { cn } from '@/lib/utils'

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full border transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50',
        checked ? 'border-primary bg-primary' : 'bg-secondary',
      )}
    >
      <span className={cn('absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-4')} />
    </button>
  )
}
