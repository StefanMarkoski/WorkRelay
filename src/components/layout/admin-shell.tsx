import { ThemeSwitcher } from '@/features/theme/theme-switcher'
import { AdminTenantsPage } from '@/pages/admin-tenants-page'
import { SignOutButton } from './user-menu'

/** Shown to a platform admin who does not belong to any workspace. */
export function AdminOnlyApp() {
  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <div className="grid size-6 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">W</div>
          <span className="text-sm font-semibold tracking-tight">WorkRelay</span>
          <span className="rounded border px-1.5 text-[10px] uppercase text-muted-foreground">Platform</span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeSwitcher />
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <AdminTenantsPage />
      </main>
    </div>
  )
}
