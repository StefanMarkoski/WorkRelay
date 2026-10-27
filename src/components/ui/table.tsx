import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const Table = ({ className, ...p }: ComponentProps<'table'>) => (
  <div className="overflow-x-auto">
    <table className={cn('w-full text-sm', className)} {...p} />
  </div>
)
export const THead = (p: ComponentProps<'thead'>) => <thead className="border-b text-left text-xs text-muted-foreground" {...p} />
export const TH = ({ className, ...p }: ComponentProps<'th'>) => (
  <th className={cn('px-4 py-2 font-medium whitespace-nowrap', className)} {...p} />
)
export const TR = ({ className, ...p }: ComponentProps<'tr'>) => (
  <tr className={cn('border-b last:border-0 hover:bg-muted/40', className)} {...p} />
)
export const TD = ({ className, ...p }: ComponentProps<'td'>) => <td className={cn('px-4 py-2.5', className)} {...p} />
