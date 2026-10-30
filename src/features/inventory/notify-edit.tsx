import { useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Input } from '@/components/ui/input'
import { errorMessage, supabase } from '@/lib/supabase'
import type { Product } from '@/types/db'

/**
 * The "Notify on" threshold of one product, editable in place by owners and admins. A number set here wins over the
 * shop's own value; 0 (or empty) removes it so the shop's value applies again. A sync never changes what is set here.
 */
export function NotifyEdit({ product, canEdit }: { product: Product; canEdit: boolean }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const effective = product.effective_notify_on
  const origin = product.notify_on_override !== null ? 'set by you' : product.notify_on !== null ? 'from the shop' : null

  function start() {
    setValue(product.notify_on_override !== null ? String(product.notify_on_override) : '')
    setError(null)
    setEditing(true)
    queueMicrotask(() => input.current?.select())
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    const n = trimmed === '' ? 0 : Number(trimmed)
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000_000) return setError('Enter a whole number, or 0 to use the shop\'s value.')
    setBusy(true)
    const { error: rpcError } = await supabase.rpc('set_notify_override', { p_product: product.id, p_value: n })
    setBusy(false)
    if (rpcError) return setError(errorMessage(rpcError))
    setEditing(false)
    void qc.invalidateQueries({ queryKey: ['products'] })
    void qc.invalidateQueries({ queryKey: ['product', product.id] })
  }

  if (editing) {
    return (
      <form onSubmit={save} className="inline-flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          <Input
            ref={input}
            aria-label={`Notify on for ${product.name}`}
            inputMode="numeric"
            className="h-8 w-24 text-right tabular-nums"
            value={value}
            placeholder={product.notify_on !== null ? String(product.notify_on) : 'None'}
            disabled={busy}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
          />
          <button type="submit" disabled={busy} className="text-xs font-medium text-foreground underline underline-offset-4 disabled:opacity-50">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
        <p className="max-w-52 text-right text-[11px] text-muted-foreground">
          Alert when stock is at or below this. 0 uses the shop's value{product.notify_on !== null ? ` (${product.notify_on.toLocaleString()})` : ' (none)'}.
        </p>
        {error && <p role="alert" className="max-w-52 text-right text-[11px] text-destructive">{error}</p>}
      </form>
    )
  }

  const shown = (
    <>
      <span className="tabular-nums">{effective !== null ? effective.toLocaleString() : '—'}</span>
      {origin && <span className="ml-1.5 text-[11px] text-muted-foreground">{origin}</span>}
    </>
  )
  if (!canEdit) return shown
  return (
    <button
      type="button"
      onClick={start}
      aria-label={`Edit notify on for ${product.name}`}
      className="group inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    >
      {shown}
      <Pencil className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  )
}
