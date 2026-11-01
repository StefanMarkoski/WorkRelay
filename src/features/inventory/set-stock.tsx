import { useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Input } from '@/components/ui/input'
import { errorMessage, supabase } from '@/lib/supabase'
import type { Product } from '@/types/db'

/**
 * Sets the count of one product by hand (a delivery, a correction), for a shop WorkRelay keeps the stock of. The number becomes
 * WorkRelay's count right away, is logged in the stock history as set in WorkRelay, and is sent to the shop. Owners and admins only.
 */
export function SetStock({ product }: { product: Product }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  function start() {
    setValue(product.stock !== null ? String(product.stock) : '')
    setError(null)
    setEditing(true)
    queueMicrotask(() => input.current?.select())
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const n = Number(value.trim())
    if (value.trim() === '' || !Number.isInteger(n) || n < 0 || n > 1_000_000_000) return setError('Enter a whole number from 0 up.')
    setBusy(true)
    const { error: rpcError } = await supabase.rpc('set_product_stock', { p_product: product.id, p_stock: n })
    setBusy(false)
    if (rpcError) return setError(errorMessage(rpcError))
    setEditing(false)
    void qc.invalidateQueries({ queryKey: ['products'] })
    void qc.invalidateQueries({ queryKey: ['product', product.id] })
    void qc.invalidateQueries({ queryKey: ['stock-pushes'] })
  }

  if (!editing) {
    return (
      <button type="button" onClick={start} className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">
        <Pencil className="size-3" aria-hidden /> Set stock
      </button>
    )
  }
  return (
    <form onSubmit={save} className="mt-2 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Input
          ref={input}
          aria-label={`Stock of ${product.name}`}
          inputMode="numeric"
          className="h-8 w-24 tabular-nums"
          value={value}
          disabled={busy}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
        />
        <button type="submit" disabled={busy} className="text-xs font-medium text-foreground underline underline-offset-4 disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
      </div>
      <p className="max-w-64 text-[11px] text-muted-foreground">This becomes WorkRelay&apos;s count and is sent to the shop.</p>
      {error && <p role="alert" className="max-w-64 text-[11px] text-destructive">{error}</p>}
    </form>
  )
}
