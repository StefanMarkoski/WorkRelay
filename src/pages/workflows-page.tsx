import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GitBranch, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states'
import { StatusBadge } from '@/components/common/status-badge'
import { Badge } from '@/components/ui/badge'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { timeAgo } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'
import type { Workflow } from '@/types/db'

export function WorkflowsPage() {
  const { current, canManage } = useWorkspace()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['workflows', current.id],
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('workflows')
        .select('id, organization_id, name, description, status, enabled, current_version_id, created_at, updated_at')
        .eq('organization_id', current.id)
        .order('updated_at', { ascending: false })
      if (e) throw e
      return data as Workflow[]
    },
  })

  async function create() {
    setError(null)
    const { data, error: e } = await supabase
      .from('workflows')
      .insert({ organization_id: current.id, name: 'Untitled workflow', draft_definition: { schema_version: 1, steps: [] } })
      .select('id')
      .single()
    if (e) return setError(errorMessage(e))
    void qc.invalidateQueries({ queryKey: ['workflows', current.id] })
    navigate(`/workflows/${data.id}`)
  }

  async function toggle(w: Workflow) {
    setError(null)
    const { error: e } = await supabase.from('workflows').update({ enabled: !w.enabled }).eq('id', w.id)
    if (e) return setError(errorMessage(e))
    void qc.invalidateQueries({ queryKey: ['workflows', current.id] })
  }

  const newButton = canManage ? <Button onClick={create}><Plus /> New workflow</Button> : undefined

  return (
    <>
      <PageHeader title="Workflows" description="Automations triggered by orders, webhooks, or manual runs." actions={newButton} />
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
      <Card>
        {query.isLoading ? <TableSkeleton rows={4} /> : query.error ? <ErrorState onRetry={() => query.refetch()} /> :
          query.data!.length === 0 ? (
            <EmptyState icon={GitBranch} title="No workflows yet" description="Create a workflow to react to new orders or incoming events." action={newButton} />
          ) : (
            <Table>
              <THead><tr><TH>Name</TH><TH>State</TH><TH>Enabled</TH><TH>Updated</TH><TH><span className="sr-only">Actions</span></TH></tr></THead>
              <tbody>
                {query.data!.map((w) => (
                  <TR key={w.id}>
                    <TD>
                      <Link to={`/workflows/${w.id}`} className="font-medium text-primary hover:underline">{w.name}</Link>
                      {w.description && <div className="max-w-md truncate text-xs text-muted-foreground">{w.description}</div>}
                    </TD>
                    <TD><StatusBadge status={w.status} /></TD>
                    <TD>{w.enabled ? <Badge tone="success">Enabled</Badge> : <Badge>Disabled</Badge>}</TD>
                    <TD className="text-muted-foreground">{timeAgo(w.updated_at)}</TD>
                    <TD className="text-right">
                      {canManage && (
                        <Button variant="ghost" size="sm" disabled={!w.enabled && !w.current_version_id} title={!w.current_version_id ? 'Publish a version first' : undefined} onClick={() => toggle(w)}>
                          {w.enabled ? 'Disable' : 'Enable'}
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
      </Card>
    </>
  )
}
