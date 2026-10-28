import { cn } from '@/lib/utils'

/** A compact tab switcher. Renders real tabs (role="tablist") for keyboard and screen-reader users. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T
  onChange: (next: T) => void
  options: { id: T; label: string }[]
  label: string
  className?: string
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('inline-flex max-w-full gap-1 overflow-x-auto rounded-lg border bg-card p-1', className)}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            value === o.id && 'bg-primary text-primary-foreground hover:text-primary-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
