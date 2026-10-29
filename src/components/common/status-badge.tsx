import { Badge, type BadgeTone } from '@/components/ui/badge'
import { humanize } from '@/lib/format'

const TONE: Record<string, BadgeTone> = {
  succeeded: 'success', processed: 'success', approved: 'success', connected: 'success', paid: 'success',
  fulfilled: 'success', completed: 'success', published: 'success',
  failed: 'danger', rejected: 'danger', revoked: 'danger', cancelled: 'danger', refunded: 'danger',
  pending: 'warning', waiting_approval: 'warning', awaiting_bind: 'warning', received: 'warning',
  unpaid: 'warning', unfulfilled: 'warning', partial: 'warning', authorized: 'warning', partially_refunded: 'warning',
  running: 'info', processing: 'info', draft: 'neutral', ignored: 'neutral', skipped: 'neutral', unknown: 'neutral',
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={TONE[status] ?? 'neutral'}>{label ?? humanize(status)}</Badge>
}
