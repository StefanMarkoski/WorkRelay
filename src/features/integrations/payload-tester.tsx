import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { ORDER_EVENT_TYPES, orderWebhookSchema } from '@/domain/orders/contract'
import { functionsBaseUrl } from './queries'

const SAMPLE = {
  event_id: 'evt_1001_created',
  event_type: 'order.created',
  occurred_at: new Date().toISOString(),
  order: {
    external_id: '1001',
    order_number: '#1001',
    currency: 'EUR',
    customer: { name: 'Ana Petrova', email: 'ana@example.com' },
    totals: { subtotal_minor: 4500, shipping_minor: 499, total_minor: 4999 },
    status: 'pending',
    payment_status: 'paid',
    fulfillment_status: 'unfulfilled',
    items: [{ sku: 'TEE-BLK-M', name: 'Black tee (M)', quantity: 1, unit_price_minor: 4500 }],
  },
}

type Result = { ok: true; note?: string } | { ok: false; issues: string[] }

/** Validates a payload against the same schema the ingestion function uses. Nothing is sent over the network. */
export function PayloadTester() {
  const [text, setText] = useState(JSON.stringify(SAMPLE, null, 2))
  const [result, setResult] = useState<Result | null>(null)

  function validate() {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      setResult({ ok: false, issues: ['Not valid JSON'] })
      return
    }
    const parsed = orderWebhookSchema.safeParse(value)
    if (!parsed.success) {
      setResult({ ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) })
      return
    }
    const supported = (ORDER_EVENT_TYPES as readonly string[]).includes(parsed.data.event_type)
    setResult({ ok: true, note: supported ? undefined : `Valid shape, but "${parsed.data.event_type}" is not a supported event type and would be recorded as ignored.` })
  }

  const curl = `curl -X POST ${functionsBaseUrl()}/order-webhook \\
  -H "Authorization: Bearer $WORKRELAY_KEY" \\
  -H "X-Store-Id: <your store id>" \\
  -H "content-type: application/json" \\
  -d @payload.json`

  return (
    <div className="space-y-3">
      <Textarea
        aria-label="Sample event payload"
        className="min-h-64 font-mono text-xs"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setResult(null)
        }}
        spellCheck={false}
      />
      <div className="flex items-center gap-2">
        <Button onClick={validate}>Validate payload</Button>
        <Button variant="ghost" onClick={() => setText(JSON.stringify({ ...SAMPLE, occurred_at: new Date().toISOString() }, null, 2))}>
          Reset sample
        </Button>
      </div>
      {result?.ok && <p role="status" className="text-sm text-success">Payload is valid.{result.note ? ` ${result.note}` : ''}</p>}
      {result && !result.ok && (
        <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-destructive">
          {result.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Delivering it from your commerce app</p>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{curl}</pre>
      </div>
    </div>
  )
}
