import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '@/features/auth/auth-provider'
import { supabase } from '@/lib/supabase'
import type { OrgRole } from '@/types/db'

export interface WorkspaceSummary {
  id: string
  name: string
  role: OrgRole
}

interface WorkspaceValue {
  workspaces: WorkspaceSummary[]
  current: WorkspaceSummary
  setCurrentId: (id: string) => void
  /** UI hint only. Authorization is enforced by RLS and RPC checks. */
  canManage: boolean
  isOwner: boolean
  userId: string
  refresh: () => Promise<unknown>
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)
const STORAGE_KEY = 'workrelay.workspace'

export function WorkspaceGate({ children, onEmpty }: { children: ReactNode; onEmpty: ReactNode }) {
  const { session } = useAuth()
  const qc = useQueryClient()
  const userId = session!.user.id
  const [storedId, setStoredId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  })

  const query = useQuery({
    queryKey: ['workspaces', userId],
    queryFn: async (): Promise<WorkspaceSummary[]> => {
      const { data, error } = await supabase
        .from('memberships')
        .select('role, organizations(id, name)')
        .eq('user_id', userId)
      if (error) throw error
      return (data ?? []).flatMap((row) => {
        const org = row.organizations as unknown as { id: string; name: string } | null
        return org ? [{ id: org.id, name: org.name, role: row.role as OrgRole }] : []
      })
    },
  })

  const value = useMemo<WorkspaceValue | null>(() => {
    const workspaces = query.data ?? []
    const current = workspaces.find((w) => w.id === storedId) ?? workspaces[0]
    if (!current) return null
    return {
      workspaces,
      current,
      setCurrentId: (id) => {
        try {
          localStorage.setItem(STORAGE_KEY, id)
        } catch {
          // ignore
        }
        setStoredId(id)
        qc.clear()
        void qc.invalidateQueries()
      },
      canManage: current.role === 'owner' || current.role === 'admin',
      isOwner: current.role === 'owner',
      userId,
      refresh: () => query.refetch(),
    }
  }, [query, storedId, qc, userId])

  if (query.isLoading) return <div className="grid h-dvh place-items-center text-sm text-muted-foreground">Loading workspace…</div>
  if (query.error) {
    return <div className="grid h-dvh place-items-center text-sm text-destructive">Could not load your workspace.</div>
  }
  if (!value) return <>{onEmpty}</>
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceGate')
  return ctx
}
