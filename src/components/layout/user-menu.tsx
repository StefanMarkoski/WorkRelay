import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-provider'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { humanize } from '@/lib/format'

export function WorkspaceSwitcher({ className = '' }: { className?: string }) {
  const { workspaces, current, setCurrentId } = useWorkspace()
  return (
    <div className={`flex items-center gap-2.5 rounded-lg border bg-card px-3 py-1.5 ${className}`}>
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-success" />
      <div className="flex min-w-0 flex-col leading-tight">
        <select
          aria-label="Workspace"
          value={current.id}
          onChange={(e) => setCurrentId(e.target.value)}
          className="max-w-44 cursor-pointer truncate bg-transparent text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&>option]:bg-popover"
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-muted-foreground">Workspace {humanize(current.role).toLowerCase()}</span>
      </div>
    </div>
  )
}

export function SignOutButton() {
  const { session, signOut } = useAuth()
  const email = session?.user.email ?? ''
  const initials = (email.split('@')[0] || '?').slice(0, 2).toUpperCase()
  return (
    <div className="flex items-center gap-2 border-l pl-3">
      <span aria-hidden className="grid size-7 place-items-center rounded-md bg-primary text-xs font-medium text-primary-foreground">
        {initials}
      </span>
      <span className="hidden max-w-44 truncate text-xs font-medium xl:block" title={email}>
        {email}
      </span>
      <Button variant="ghost" size="icon-sm" aria-label="Sign out" title="Sign out" onClick={signOut} className="text-muted-foreground hover:text-destructive">
        <LogOut />
      </Button>
    </div>
  )
}
