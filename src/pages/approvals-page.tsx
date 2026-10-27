import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckSquare } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Textarea } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { JsonView } from '@/components/common/json-view'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states'
import { StatusBadge } from '@/components/common/status-badge'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDateTime, humanize } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'
import type { Approval, OrgRole } from '@/types/db'

/** UI hint only; decide_approval enforces the same rule in the database. */
function mayDecide(a: Approval, userId: string, role: OrgRole) {
  if (a.reviewer_user_id) return a.reviewer_user_id === userId
  if (a.reviewer_role === 'member') return true
  if (a.reviewer_role === 'owner') return role === 'owner'
  return role === 'owner' || role === 'admin'
}

export function ApprovalsPage() {
  const { current, userId } = useWorkspace()
  const qc = useQueryClient()
  const [tab, setTab] = useState<'pending' | 'history'>('pending')
  const [target, setTarget] = useState<Approval | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const query = useQuery({
    queryKey: ['approvals', current.id, tab],
    queryFn: async () => {
      let q = supabase.from('approvals').select('*').eq('organization_id', current.id).limit(100)
      q = tab === 'pending' ? q.eq('status', 'pending').order('created_at', { ascending: true }) : q.neq('status', 'pending').order('decided_at', { ascending: false })
      const { data, error: e } = await q
      if (e) throw e
      return data as Approval[]
    },
  })

  async function decide(decision: 'approved' | 'rejected') {
    if (!target) return
    setBusy(true)
    setError(null)
    const { error: e } = await supabase.rpc('decide_approval', { p_id: target.id, p_decision: decision, p_comment: comment || null })
    setBusy(false)
    if (e) return setError(errorMessage(e))
    setTarget(null)
    setComment('')
    void qc.invalidateQueries({ queryKey: ['approvals'] })
    void qc.invalidateQueries({ queryKey: ['overview'] })
  }

  return (
    <>
      <PageHeader title="Approvals" description="Human decisions requested by workflows. A paused run resumes after a valid decision." />
      <div role="tablist" className="mb-4 flex gap-1 border-b">
        {(['pending', 'history'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === t ? 'border-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {humanize(t)}
          </button>
        ))}
      </div>
      <Card>
        {query.isLoading ? <TableSkeleton rows={4} /> : query.error ? <ErrorState onRetry={() => query.refetch()} /> :
          query.data!.length === 0 ? (
            <EmptyState icon={CheckSquare} title={tab === 'pending' ? 'Nothing waiting for you' : 'No decisions yet'}
              description={tab === 'pending' ? 'Approval requests created by workflows will show up here.' : 'Approved and rejected requests are kept here.'} />
          ) : (
            <Table>
              <THead><tr><TH>Request</TH><TH>Status</TH><TH>Reviewer</TH><TH>{tab === 'pending' ? 'Requested' : 'Decided'}</TH><TH>Comment</TH><TH><span className="sr-only">Actions</span></TH></tr></THead>
              <tbody>
                {query.data!.map((a) => (
                  <TR key={a.id}>
                    <TD className="font-medium">
                      {a.title}
                      {a.run_id && <Link to={`/executions/${a.run_id}`} className="ml-2 text-xs font-normal text-primary hover:underline">View run</Link>}
                    </TD>
                    <TD><StatusBadge status={a.status} /></TD>
                    <TD className="text-muted-foreground">{a.reviewer_user_id ? 'Specific reviewer' : humanize(a.reviewer_role === 'admin' ? 'owners and admins' : a.reviewer_role === 'owner' ? 'owners only' : 'any member')}</TD>
                    <TD className="whitespace-nowrap">{formatDateTime(tab === 'pending' ? a.created_at : a.decided_at)}</TD>
                    <TD className="max-w-60 truncate text-muted-foreground" title={a.comment ?? undefined}>{a.comment ?? '—'}</TD>
                    <TD className="text-right">
                      {a.status === 'pending' && (
                        <Button size="sm" variant="outline" disabled={!mayDecide(a, userId, current.role)}
                          title={!mayDecide(a, userId, current.role) ? 'You are not a permitted reviewer' : undefined}
                          onClick={() => { setError(null); setComment(''); setTarget(a) }}>Review</Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
      </Card>

      <Modal open={target !== null} onClose={() => setTarget(null)} title={target?.title ?? 'Review request'}>
        <div className="space-y-4">
          <div><p className="mb-1 text-xs text-muted-foreground">Context</p><JsonView value={target?.context} /></div>
          <Field label="Comment (optional)" error={error}>
            {(id) => <Textarea id={id} value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTarget(null)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={() => decide('rejected')}>Reject</Button>
            <Button disabled={busy} onClick={() => decide('approved')}>Approve</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
