import { Card } from '@/components/ui/card'
import { EventHistory } from '@/features/integrations/event-history'

/** What this shop has sent, newest first. */
export function ActivityTab({ shopId }: { shopId: string }) {
  return (
    <Card>
      <EventHistory shopId={shopId} />
    </Card>
  )
}
