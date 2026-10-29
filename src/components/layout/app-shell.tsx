import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { BrandMark } from '@/components/common/brand-mark'
import { useRealtimeSync } from '@/features/realtime/use-realtime-sync'
import { ThemeSwitcher } from '@/features/theme/theme-switcher'
import { LiveIndicator } from './live-indicator'
import { Sidebar } from './sidebar'
import { SignOutButton, WorkspaceSwitcher } from './user-menu'

export function AppShell() {
  const [open, setOpen] = useState(false)
  const live = useRealtimeSync()
  const { pathname } = useLocation()
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between gap-3 border-b bg-sidebar px-4 text-foreground lg:px-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-md border bg-card p-2 text-muted-foreground hover:text-foreground lg:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-8" />
            <span className="font-display text-base font-semibold tracking-tight">WorkRelay</span>
          </div>
          <div className="hidden h-5 w-px bg-border sm:block" />
          <WorkspaceSwitcher className="hidden sm:flex" />
        </div>
        <div className="flex items-center gap-3">
          <LiveIndicator status={live} />
          <div className="hidden sm:block"><ThemeSwitcher /></div>
          <SignOutButton />
        </div>
      </header>

      <div className="flex flex-1">
        {open && <button type="button" aria-label="Close menu" className="fixed inset-0 z-20 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}
        <aside
          className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r bg-sidebar pt-16 text-foreground transition-transform duration-200 lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)] lg:translate-x-0 lg:pt-0 ${
            open ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Sidebar onNavigate={() => setOpen(false)} />
          <div className="space-y-3 border-t p-4 sm:hidden">
            <WorkspaceSwitcher />
            <ThemeSwitcher />
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          <div key={pathname} className="page-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
