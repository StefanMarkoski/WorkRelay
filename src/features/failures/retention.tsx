import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { errorMessage, supabase } from '@/lib/supabase'

export const MIN_RETENTION_DAYS = 1
export const MAX_RETENTION_DAYS = 365

/** How many days this workspace keeps failures (failed events and failed automation runs) before they are removed. */
export function useFailureRetention(orgId: string) {
  return useQuery({
    queryKey: ['failure-retention', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('organizations').select('failure_retention_days').eq('id', orgId).single()
      if (error) throw error
      return Number((data as { failure_retention_days: number }).failure_retention_days)
    },
  })
}

/** A whole number of days from 1 to 365, or null when what was typed is not one. */
export function parseRetentionDays(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null
  const n = Number(text.trim())
  return n >= MIN_RETENTION_DAYS && n <= MAX_RETENTION_DAYS ? n : null
}

/** Settings → how long failures stay. Saving a smaller number removes the older failures at the next cleanup, so it says how many. */
export function FailureRetentionCard({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const qc = useQueryClient()
  const saved = useFailureRetention(orgId)
  const [text, setText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const current = saved.data ?? null
  const value = text ?? (current !== null ? String(current) : '')
  const days = parseRetentionDays(value)
  const changed = days !== null && current !== null && days !== current

  // What saving this number would remove, shown before it is saved. Only asked when the number is smaller than today's.
  const preview = useQuery({
    queryKey: ['failures-older-than', orgId, days],
    enabled: changed && days < (current ?? 0),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('failures_older_than', { p_org: orgId, p_days: days })
      if (error) throw error
      return Number(data ?? 0)
    },
  })
  const toRemove = changed && days! < (current ?? 0) ? preview.data ?? null : 0

  async function save(e: FormEvent) {
    e.preventDefault()
    if (days === null) return
    setBusy(true)
    setMsg(null)
    // Saving removes the failures that are already older than the number, right away. The answer is how many it removed.
    const { data, error } = await supabase.rpc('set_failure_retention', { p_org: orgId, p_days: days })
    setBusy(false)
    if (error) return setMsg({ tone: 'error', text: errorMessage(error) })
    const removed = Number(data ?? 0)
    const rest = toRemove && toRemove > removed ? toRemove - removed : 0
    setText(null)
    setMsg({
      tone: 'ok',
      text: removed
        ? `Saved. ${removed.toLocaleString()} older ${removed === 1 ? 'failure was' : 'failures were'} removed${rest ? `; the other ${rest.toLocaleString()} are being removed in the background` : ''}.`
        : 'Saved.',
    })
    void qc.invalidateQueries({ queryKey: ['failure-retention', orgId] })
    void qc.invalidateQueries({ queryKey: ['failures'] })
  }

  return (
    <Card>
      <CardHeader><CardTitle>Failures</CardTitle></CardHeader>
      <CardBody>
        <form onSubmit={save} className="max-w-xl space-y-3">
          <p className="text-sm text-muted-foreground">
            Failed events and failed automation runs are removed automatically once they are older than this. Events that went through, and runs
            that succeeded, are never touched. A removed failure cannot be brought back.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-40">
              <Field label="Keep failures for (days)" error={days === null && value !== '' ? `Enter a whole number from ${MIN_RETENTION_DAYS} to ${MAX_RETENTION_DAYS}.` : null}>
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={MIN_RETENTION_DAYS}
                    max={MAX_RETENTION_DAYS}
                    step={1}
                    value={value}
                    disabled={!canManage || current === null}
                    onChange={(e) => { setText(e.target.value); setMsg(null) }}
                  />
                )}
              </Field>
            </div>
            {canManage && (
              <Button type="submit" disabled={busy || !changed || (days! < (current ?? 0) && preview.isLoading)}>
                {busy ? 'Saving…' : toRemove ? `Save and remove ${toRemove.toLocaleString()}` : 'Save'}
              </Button>
            )}
          </div>
          {toRemove ? (
            <p role="status" className="text-xs">
              {toRemove.toLocaleString()} {toRemove === 1 ? 'failure is' : 'failures are'} older than {days} {days === 1 ? 'day' : 'days'} and will be removed as soon as you save. This cannot be undone.
            </p>
          ) : null}
          {!canManage && <p className="text-xs text-muted-foreground">Only owners and admins can change this.</p>}
          {msg && <p role={msg.tone === 'error' ? 'alert' : 'status'} className={msg.tone === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{msg.text}</p>}
        </form>
      </CardBody>
    </Card>
  )
}
