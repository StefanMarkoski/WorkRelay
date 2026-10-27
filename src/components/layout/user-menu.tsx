import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { useAuth } from '@/features/auth/auth-provider'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { humanize } from '@/lib/format'

export function WorkspaceSwitcher() {
  const { workspaces, current, setCurrentId } = useWorkspace()
  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label="Workspace"
        className="w-44"
        value={current.id}
        onChange={(e) => setCurrentId(e.target.value)}
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </Select>
      <span className="hidden text-xs text-muted-foreground sm:inline">{humanize(current.role)}</span>
    </div>
  )
}

export function SignOutButton() {
  const { session, signOut } = useAuth()
  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-40 truncate text-xs text-muted-foreground md:inline">{session?.user.email}</span>
      <Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out" onClick={signOut}>
        <LogOut />
      </Button>
    </div>
  )
}
