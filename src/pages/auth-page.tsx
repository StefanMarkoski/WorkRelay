import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'

const credentials = z.object({
  email: z.email('Enter a valid email'),
  password: z.string().min(8, 'Use at least 8 characters'),
})

export function AuthPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const parsed = credentials.safeParse({ email: form.get('email'), password: form.get('password') })
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
      return
    }
    setErrors({})
    setMessage(null)
    setBusy(true)
    const { error, data } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword(parsed.data)
        : await supabase.auth.signUp({
            ...parsed.data,
            options: { emailRedirectTo: window.location.origin + window.location.pathname },
          })
    setBusy(false)
    if (error) {
      // Same wording for unknown email and wrong password.
      setMessage({ tone: 'error', text: mode === 'signin' ? 'Invalid email or password.' : error.message })
    } else if (mode === 'signup' && !data.session) {
      setMessage({ tone: 'info', text: 'Check your email to confirm your account, then sign in.' })
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2">
          <div className="grid size-7 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">W</div>
          <span className="text-base font-semibold tracking-tight">WorkRelay</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold">{mode === 'signin' ? 'Sign in to your workspace' : 'Create your account'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Operations and workflow automation for your commerce stack.</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-card p-4" noValidate>
          <Field label="Email" error={errors.email}>
            {(id) => <Input id={id} name="email" type="email" autoComplete="email" required />}
          </Field>
          <Field label="Password" error={errors.password}>
            {(id) => (
              <Input id={id} name="password" type="password" required autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
            )}
          </Field>
          {message && (
            <p role="alert" className={message.tone === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
              {message.text}
            </p>
          )}
          <Button type="submit" className="w-full" size="lg" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
        <p className="text-sm text-muted-foreground">
          {mode === 'signin' ? 'New to WorkRelay?' : 'Already have an account?'}{' '}
          <button
            type="button"
            className="text-primary underline-offset-4 hover:underline"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setMessage(null)
              setErrors({})
            }}
          >
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}

export function ConfigMissing() {
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <div className="max-w-md space-y-2 rounded-lg border bg-card p-6">
        <h1 className="font-semibold">Supabase is not configured</h1>
        <p className="text-sm text-muted-foreground">
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env.local</code> (see{' '}
          <code>docs/supabase-setup.md</code>) and restart the dev server.
        </p>
      </div>
    </div>
  )
}
