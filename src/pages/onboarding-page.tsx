import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { ShimmerButton } from '@/components/ui/shimmer-button'
import { Field, Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/auth-provider'
import { errorMessage, supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'

export function OnboardingPage() {
  const { signOut } = useAuth()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim()
    if (!name || name.length > 120) {
      setError('Enter a workspace name (up to 120 characters).')
      return
    }
    setBusy(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('create_organization', { org_name: name })
    setBusy(false)
    if (rpcError) setError(errorMessage(rpcError))
    else await qc.invalidateQueries({ queryKey: ['workspaces'] })
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-lg border bg-card p-6">
        <div>
          <h1 className="text-lg font-semibold">Create your workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A workspace holds your workflows, integrations and orders. You will be its owner.
          </p>
        </div>
        <Field label="Workspace name" error={error}>
          {(id) => <Input id={id} name="name" placeholder="Acme Operations" maxLength={120} required autoFocus />}
        </Field>
        <ShimmerButton
          type="submit"
          disabled={busy}
          borderRadius="8px"
          background="var(--primary)"
          shimmerColor="oklch(0.95 0.05 285)"
          shimmerDuration="4s"
          className="h-9 w-full text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {busy ? 'Creating…' : 'Create workspace'}
        </ShimmerButton>
        <Button type="button" variant="ghost" size="sm" className="w-full" onClick={signOut}>
          Sign out
        </Button>
      </form>
    </div>
  )
}
