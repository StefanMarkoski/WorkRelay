import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { STEP_LABELS, type DraftStep } from './draft'

interface Props {
  step: DraftStep
  index: number
  total: number
  allSteps: DraftStep[]
  issues: string[]
  onChange: (next: DraftStep) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  readOnly: boolean
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

function Target({ label, value, steps, selfId, onChange, disabled }: {
  label: string; value: unknown; steps: DraftStep[]; selfId: string; onChange: (v: string | null) => void; disabled: boolean
}) {
  return (
    <Field label={label}>
      {(id) => (
        <Select id={id} value={str(value)} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">End of workflow</option>
          {steps.filter((s) => s.id !== selfId).map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.id})</option>
          ))}
        </Select>
      )}
    </Field>
  )
}

export function StepEditor({ step, index, total, allSteps, issues, onChange, onMove, onRemove, readOnly }: Props) {
  const set = (patch: Record<string, unknown>) => onChange({ ...step, ...patch })
  const text = (key: string, label: string, props: { multiline?: boolean; placeholder?: string; hint?: string } = {}) => (
    <Field label={label} hint={props.hint}>
      {(id) =>
        props.multiline ? (
          <Textarea id={id} value={str(step[key])} disabled={readOnly} placeholder={props.placeholder} onChange={(e) => set({ [key]: e.target.value })} />
        ) : (
          <Input id={id} value={str(step[key])} disabled={readOnly} placeholder={props.placeholder} onChange={(e) => set({ [key]: e.target.value })} />
        )
      }
    </Field>
  )

  return (
    <div className={`rounded-lg border bg-card ${issues.length ? 'border-warning/60' : ''}`}>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="grid size-5 place-items-center rounded bg-accent text-xs font-medium text-accent-foreground">{index + 1}</span>
          <span className="text-sm font-medium">{STEP_LABELS[step.type]}</span>
          {index === 0 && <Badge tone="violet">Entry</Badge>}
          {issues.length > 0 && <Badge tone="warning">Incomplete</Badge>}
        </div>
        {!readOnly && (
          <div className="flex gap-0.5">
            <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={index === total - 1} onClick={() => onMove(1)}><ArrowDown /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Delete step" onClick={onRemove}><Trash2 /></Button>
          </div>
        )}
      </div>
      <div className="grid gap-3 p-3 sm:grid-cols-2">
        {text('name', 'Name')}
        <Field label="Step ID" hint="Used by routing and in execution history.">
          {(id) => <Input id={id} value={step.id} disabled />}
        </Field>

        {step.type === 'condition' && (
          <>
            {text('field', 'Field', { placeholder: 'order.total_minor' })}
            <Field label="Operator">
              {(id) => (
                <Select id={id} value={str(step.operator)} disabled={readOnly} onChange={(e) => set({ operator: e.target.value })}>
                  <option value="eq">equals</option><option value="neq">does not equal</option>
                  <option value="gt">greater than</option><option value="lt">less than</option>
                  <option value="contains">contains</option><option value="exists">exists</option>
                </Select>
              )}
            </Field>
            <Field label="Value">
              {(id) => (
                <Input
                  id={id}
                  value={str(step.value)}
                  disabled={readOnly || step.operator === 'exists'}
                  onChange={(e) => {
                    const v = e.target.value
                    set({ value: (step.operator === 'gt' || step.operator === 'lt') && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v })
                  }}
                />
              )}
            </Field>
            <div />
            <Target label="If true, continue to" value={step.on_true} steps={allSteps} selfId={step.id} disabled={readOnly} onChange={(v) => set({ on_true: v })} />
            <Target label="If false, continue to" value={step.on_false} steps={allSteps} selfId={step.id} disabled={readOnly} onChange={(v) => set({ on_false: v })} />
          </>
        )}

        {step.type === 'http_request' && (
          <>
            <Field label="Method">
              {(id) => (
                <Select id={id} value={str(step.method)} disabled={readOnly} onChange={(e) => set({ method: e.target.value })}>
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
                </Select>
              )}
            </Field>
            {text('url', 'URL', { placeholder: 'https://api.example.com/hook', hint: 'https only. Internal and metadata addresses are blocked.' })}
            <div className="sm:col-span-2">{text('body', 'Body (optional)', { multiline: true })}</div>
          </>
        )}

        {step.type === 'create_approval' && (
          <>
            {text('title', 'Request title', { placeholder: 'Approve high-value order' })}
            <Field label="Who can decide">
              {(id) => (
                <Select id={id} value={str(step.reviewer_role)} disabled={readOnly} onChange={(e) => set({ reviewer_role: e.target.value })}>
                  <option value="admin">Owners and administrators</option>
                  <option value="owner">Owners only</option>
                  <option value="member">Any member</option>
                </Select>
              )}
            </Field>
          </>
        )}

        {step.type === 'record_result' && (
          <>
            <Field label="Result">
              {(id) => (
                <Select id={id} value={str(step.result)} disabled={readOnly} onChange={(e) => set({ result: e.target.value })}>
                  <option value="succeeded">Succeeded</option><option value="failed">Failed</option>
                </Select>
              )}
            </Field>
            {text('message', 'Message (optional)')}
          </>
        )}

        {step.type !== 'condition' && step.type !== 'record_result' && (
          <div className="sm:col-span-2">
            <Target label="Then continue to" value={step.next} steps={allSteps} selfId={step.id} disabled={readOnly} onChange={(v) => set({ next: v })} />
          </div>
        )}
      </div>
      {issues.length > 0 && (
        <ul className="border-t px-3 py-2 text-xs text-warning">
          {issues.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
    </div>
  )
}
