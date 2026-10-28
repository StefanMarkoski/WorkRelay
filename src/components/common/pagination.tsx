import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  return (
    <div className="flex items-center justify-between border-t bg-sidebar px-4 py-3 text-xs text-muted-foreground">
      <span>
        Showing {from} to {to} of {total} {total === 1 ? 'entry' : 'entries'}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)}>
          <ChevronLeft />
        </Button>
        <span className="min-w-14 text-center tabular-nums">
          {page + 1} / {pages}
        </span>
        <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
