import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { router } from '@/app/router'
import { AuthProvider, useAuth } from '@/features/auth/auth-provider'
import { WorkspaceGate } from '@/features/workspace/workspace-provider'
import { ThemeProvider } from '@/features/theme/theme-provider'
import { isSupabaseConfigured } from '@/lib/supabase'
import { AuthPage, ConfigMissing } from '@/pages/auth-page'
import { OnboardingPage } from '@/pages/onboarding-page'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
})

function Authenticated() {
  const { session, loading } = useAuth()
  if (loading) return <div className="grid h-dvh place-items-center text-sm text-muted-foreground">Loading…</div>
  if (!session) return <AuthPage />
  return (
    <WorkspaceGate onEmpty={<OnboardingPage />}>
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
