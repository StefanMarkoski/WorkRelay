import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { router } from '@/app/router'
import { AuthProvider, useAuth } from '@/features/auth/auth-provider'
import { WorkspaceGate } from '@/features/workspace/workspace-provider'
import { ThemeProvider } from '@/features/theme/theme-provider'
import { isSupabaseConfigured } from '@/lib/supabase'
import { AdminOnlyApp } from '@/components/layout/admin-shell'
import { useIsPlatformAdmin } from '@/features/admin/queries'
import { AuthPage, ConfigMissing } from '@/pages/auth-page'
import { OnboardingPage } from '@/pages/onboarding-page'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
})

/** A user with no workspace: platform admins get the tenants console, everyone else creates a workspace. */
function NoWorkspace() {
  const admin = useIsPlatformAdmin()
  if (admin.isLoading) return <div className="grid h-dvh place-items-center text-sm text-muted-foreground">Loading…</div>
  return admin.data === true ? <AdminOnlyApp /> : <OnboardingPage />
}

function Authenticated() {
  const { session, loading } = useAuth()
  if (loading) return <div className="grid h-dvh place-items-center text-sm text-muted-foreground">Loading…</div>
  if (!session) return <AuthPage />
  return (
    <WorkspaceGate onEmpty={<NoWorkspace />}>
      <RouterProvider router={router} />
    </WorkspaceGate>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      {isSupabaseConfigured ? (
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <Authenticated />
          </AuthProvider>
        </QueryClientProvider>
      ) : (
        <ConfigMissing />
      )}
    </ThemeProvider>
  )
}
