import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export type BadgeTone = 'neutral' | 'violet' | 'success' | 'warning' | 'danger'

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-border bg-secondary text-muted-foreground',
  violet: 'border-primary/30 bg-primary/15 text-accent-foreground',
  success: 'border-success/30 bg-success/15 text-success',
  warning: 'border-warning/30 bg-warning/15 text-warning',
  danger: 'border-destructive/30 bg-destructive/15 text-destructive',
}

export function Badge({ tone = 'neutral', className, ...props }: ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap', TONES[tone], className)}
      {...props}
    />
  )
}
