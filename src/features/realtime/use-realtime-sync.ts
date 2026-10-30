import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { supabase } from '@/lib/supabase'

export type LiveStatus = 'connecting' | 'live' | 'offline'

/**
 * Which cached queries to refresh when a table changes. Realtime only carries the signal; the data is re-read through
 * the normal queries, so row-level security still decides what each person sees. Only tables whose columns are all
 * client-readable are published (never webhook_events or integrations).
 */
const TABLES: Record<string, QueryKey[]> = {
  orders: [['orders'], ['order'], ['overview'], ['customers'], ['customer'], ['live'], ['insights']],
  order_events: [['order'], ['overview']],
  workflow_runs: [['runs'], ['run'], ['overview'], ['automations'], ['live'], ['insights']],
  step_runs: [['run']],
  approvals: [['approvals'], ['overview'], ['live']],
  // A shop's push: the Live feed, the stock it just changed, and the "synced X ago" lines all refresh. (integration_sync is never published: it holds a secret.)
  product_sync_events: [['live'], ['products'], ['product'], ['integration-sync'], ['insights']],
}

const DEBOUNCE_MS = 300

export function useRealtimeSync(): LiveStatus {
  const { current } = useWorkspace()
  const qc = useQueryClient()
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const wasOffline = useRef(false)

  useEffect(() => {
    const pending = new Map<string, QueryKey>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      timer = undefined
      for (const key of pending.values()) void qc.invalidateQueries({ queryKey: key })
      pending.clear()
    }
    const schedule = (keys: QueryKey[]) => {
      for (const key of keys) pending.set(JSON.stringify(key), key)
      if (!timer) timer = setTimeout(flush, DEBOUNCE_MS)
    }

    setStatus('connecting')
    let channel = supabase.channel(`org-${current.id}`)
    for (const [table, keys] of Object.entries(TABLES)) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `organization_id=eq.${current.id}` },
        () => schedule(keys),
      )
    }
    channel.subscribe((s) => {
      if (s === 'SUBSCRIBED') {
        setStatus('live')
        // Changes may have been missed while disconnected: resync everything once.
        if (wasOffline.current) schedule(Object.values(TABLES).flat())
        wasOffline.current = false
      } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
        wasOffline.current = true
        setStatus('offline')
      }
    })

    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [current.id, qc])

  return status
}
