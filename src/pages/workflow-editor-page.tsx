import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { ErrorState, TableSkeleton } from '@/components/common/states'
import { StatusBadge } from '@/components/common/status-badge'
import { UNAVAILABLE_STEP_TYPES, validateDefinition, type StepType, type TriggerType } from '@/domain/workflows'
import { useIntegrations } from '@/features/integrations/queries'
import { StepEditor } from '@/features/workflows/step-editor'
import {
  TRIGGER_LABELS, STEP_LABELS, appendStep, availableStepTypes, newStep, normalizeDraft, removeStep, toStored,
  type DraftDefinition,
} from '@/features/workflows/draft'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDateTime } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'
import type { Workflow, WorkflowVersion } from '@/types/db'

export function WorkflowEditorPage() {
  const { id } = useParams()
  const { canManage } = useWorkspace()
  const qc = useQueryClient()
  const integrations = useIntegrations()
  const navigate = useNavigate()

  const query = useQuery({
    queryKey: ['workflow', id],
    queryFn: async () => {
      const [wf, versions] = await Promise.all([
        supabase.from('workflows').select('*').eq('id', id!).maybeSingle(),
        supabase.from('workflow_versions').select('id, workflow_id, version, definition, created_at').eq('workflow_id', id!).order('version', { ascending: false }),
      ])
      if (wf.error) throw wf.error
      if (versions.error) throw versions.error
      return { workflow: wf.data as Workflow | null, versions: versions.data as WorkflowVersion[] }
    },
  })

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [draft, setDraft] = useState<DraftDefinition>({ schema_version: 1, trigger: null, steps: [] })
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const wf = query.data?.workflow
    if (wf && !loaded) {
      setName(wf.name)
      setDescription(wf.description)
      setDraft(normalizeDraft(wf.draft_definition))
      setLoaded(true)
    }
  }, [query.data, loaded])

  const validation = useMemo(() => validateDefinition(toStored(draft)), [draft])
  const issuesByStep = useMemo(() => {
    const map = new Map<number, string[]>()
    if (!validation.ok) {
      for (const i of validation.issues) {
        const m = /^steps\.(\d+)/.exec(i.path)
        if (m) map.set(Number(m[1]), [...(map.get(Number(m[1])) ?? []), i.message])
      }
    }
    return map
  }, [validation])

  if (query.isLoading) return <TableSkeleton rows={8} />
  if (query.error) return <ErrorState onRetry={() => query.refetch()} />
  const wf = query.data!.workflow
  if (!wf) return <ErrorState message="Workflow not found." />
  const versions = query.data!.versions
  const published = versions.find((v) => v.id === wf.current_version_id)
  const dirty =
    name !== wf.name || description !== wf.description ||
    JSON.stringify(toStored(draft)) !== JSON.stringify(toStored(normalizeDraft(wf.draft_definition)))
  const unpublished = !published || JSON.stringify(published.definition) !== JSON.stringify(toStored(draft))
  const readOnly = !canManage

  async function save(): Promise<boolean> {
    setBusy(true)
    const { error } = await supabase
      .from('workflows')
      .update({ name: name.trim() || 'Untitled workflow', description, draft_definition: toStored(draft) })
      .eq('id', wf!.id)
    setBusy(false)
    if (error) {
      setMessage({ tone: 'error', text: errorMessage(error) })
      return false
    }
    await qc.invalidateQueries({ queryKey: ['workflow', id] })
    void qc.invalidateQueries({ queryKey: ['workflows'] })
    return true
  }

  async function onSave() {
    if (await save()) setMessage({ tone: 'ok', text: 'Draft saved.' })
  }

  async function onPublish() {
    if (!(await save())) return
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('publish-workflow', { body: { workflow_id: wf!.id } })
    setBusy(false)
    if (error) {
      let text = 'Publishing failed.'
      try {
        const body = await (error as { context?: Response }).context?.json()
        if (body?.issues) text = `Cannot publish: ${(body.issues as { message: string }[]).map((i) => i.message).join('; ')}`
        else if (body?.error === 'forbidden') text = 'You do not have permission to publish.'
      } catch { /* keep generic text */ }
      return setMessage({ tone: 'error', text })
    }
    void data
    setMessage({ tone: 'ok', text: 'Published as a new immutable version.' })
    await qc.invalidateQueries({ queryKey: ['workflow', id] })
    void qc.invalidateQueries({ queryKey: ['workflows'] })
  }

  async function onRunTest() {
    setBusy(true)
    const { data, error } = await supabase.rpc('start_manual_run', { p_workflow: wf!.id })
    setBusy(false)
    if (error) return setMessage({ tone: 'error', text: errorMessage(error) })
    navigate(`/executions/${data as string}`)
  }

  const update = (fn: (d: DraftDefinition) => DraftDefinition) => setDraft((d) => fn(d))

  return (
    <>
      <Link to="/workflows" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Workflows
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={wf.status} />
          {published && <Badge>v{published.version} live</Badge>}
          {unpublished && wf.status === 'published' && <Badge tone="warning">Unpublished changes</Badge>}
          {dirty && <Badge tone="warning">Unsaved</Badge>}
        </div>
        {canManage && (
          <div className="flex gap-2">
            {published && (
              <Button variant="outline" disabled={busy} onClick={onRunTest} title="Runs the live published version">Run test</Button>
            )}
            <Button variant="outline" disabled={busy || !dirty} onClick={onSave}>Save draft</Button>
            <Button disabled={busy || !validation.ok || (!dirty && !unpublished)} onClick={onPublish}>Publish</Button>
          </div>
        )}
      </div>
      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mb-4 text-sm ${message.tone === 'error' ? 'text-destructive' : 'text-success'}`}>{message.text}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardBody className="grid gap-3">
              <Field label="Name">{(fid) => <Input id={fid} value={name} maxLength={120} disabled={readOnly} onChange={(e) => setName(e.target.value)} />}</Field>
              <Field label="Description">{(fid) => <Textarea id={fid} value={description} maxLength={2000} disabled={readOnly} onChange={(e) => setDescription(e.target.value)} />}</Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>Trigger</CardTitle></CardHeader>
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <Field label="When">
                {(fid) => (
                  <Select
                    id={fid}
                    value={draft.trigger?.type ?? ''}
                    disabled={readOnly}
                    onChange={(e) => update((d) => ({ ...d, trigger: e.target.value ? { type: e.target.value as TriggerType } : null }))}
                  >
                    <option value="">Choose a trigger…</option>
                    {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((t) => <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>)}
                  </Select>
                )}
              </Field>
              {draft.trigger?.type === 'webhook' && (
                <Field label="Connection" hint={integrations.data?.length === 0 ? 'Connect a store under Integrations first.' : undefined}>
                  {(fid) => (
                    <Select id={fid} value={draft.trigger?.integration_id ?? ''} disabled={readOnly}
                      onChange={(e) => update((d) => ({ ...d, trigger: { type: 'webhook', integration_id: e.target.value || undefined } }))}>
                      <option value="">Choose a connection…</option>
                      {integrations.data?.filter((i) => i.status !== 'revoked').map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </Select>
                  )}
                </Field>
              )}
              {draft.trigger?.type === 'order_status_changed' && (
                <Field label="Only when the new status is (optional)">
                  {(fid) => (
                    <Select id={fid} value={draft.trigger?.to_status ?? ''} disabled={readOnly}
                      onChange={(e) => update((d) => ({ ...d, trigger: { type: 'order_status_changed', to_status: e.target.value || undefined } }))}>
                      <option value="">Any status</option>
                      {['pending', 'processing', 'completed', 'cancelled'].map((s) => <option key={s}>{s}</option>)}
                    </Select>
                  )}
                </Field>
              )}
              {!draft.trigger && <p className="text-xs text-warning sm:col-span-2">A trigger is required before publishing.</p>}
              {!validation.ok && draft.trigger && validation.issues.some((i) => i.path.startsWith('trigger')) && (
                <p className="text-xs text-warning sm:col-span-2">Trigger configuration is incomplete.</p>
              )}
            </CardBody>
          </Card>

          <div className="space-y-3">
            <h2 className="text-sm font-medium">Steps</h2>
            {draft.steps.length === 0 && (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No steps yet. The first step you add is the entry point.</p>
            )}
            {draft.steps.map((s, i) => (
              <StepEditor
                key={s.id}
                step={s}
                index={i}
                total={draft.steps.length}
                allSteps={draft.steps}
                issues={issuesByStep.get(i) ?? []}
                readOnly={readOnly}
                onChange={(next) => update((d) => ({ ...d, steps: d.steps.map((x) => (x.id === s.id ? next : x)) }))}
                onMove={(dir) => update((d) => {
                  const steps = [...d.steps]
                  ;[steps[i], steps[i + dir]] = [steps[i + dir], steps[i]]
                  return { ...d, steps }
                })}
                onRemove={() => update((d) => removeStep(d, s.id))}
              />
            ))}
            {canManage && (
              <div className="flex flex-wrap items-center gap-2">
                <Select aria-label="Step type to add" className="w-64" id="add-step" defaultValue="">
                  <option value="" disabled>Add a step…</option>
                  {availableStepTypes.map((t) => <option key={t} value={t}>{STEP_LABELS[t]}</option>)}
                  {(Object.keys(UNAVAILABLE_STEP_TYPES) as StepType[]).map((t) => (
                    <option key={t} value={t} disabled>{STEP_LABELS[t]} (unavailable)</option>
                  ))}
                </Select>
                <Button variant="outline" onClick={() => {
                  const sel = document.getElementById('add-step') as HTMLSelectElement
                  if (!sel.value) return
                  update((d) => appendStep(d, newStep(sel.value as StepType, d.steps)))
                  sel.value = ''
                }}><Plus /> Add</Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Email actions are unavailable until an email provider integration exists.</p>
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Readiness</CardTitle></CardHeader>
            <CardBody>
              {validation.ok ? (
                <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" /> Valid and ready to publish.</p>
              ) : (
                <ul className="space-y-1.5 text-sm text-warning">
                  {validation.issues.slice(0, 8).map((i, idx) => <li key={idx}>{i.message}</li>)}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>Version history</CardTitle></CardHeader>
            <CardBody className="space-y-2">
              {versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing published yet.</p>
              ) : versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between text-sm">
                  <span>v{v.version}{v.id === wf.current_version_id && <Badge tone="success" className="ml-2">Live</Badge>}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(v.created_at)}</span>
                </div>
              ))}
              <p className="border-t pt-2 text-xs text-muted-foreground">Published versions are immutable. Runs always reference the version that started them.</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
