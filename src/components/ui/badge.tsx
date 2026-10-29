import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/** A status reads as a small lamp beside a label, the same part the relay unit is made of. Neutral shows no lamp. */
const LAMP: Record<BadgeTone, string | null> = {
  neutral: null,
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
}

export function Badge({ tone = 'neutral', className, children, ...props }: ComponentProps<'span'> & { tone?: BadgeTone }) {
  const lamp = LAMP[tone]
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-md border bg-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap', tone === 'neutral' ? 'text-muted-foreground' : 'text-foreground', className)}
      {...props}
    >
      {lamp && <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', lamp)} />}
      {children}
    </span>
  )
}
