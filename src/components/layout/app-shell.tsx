import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { ThemeSwitcher } from '@/features/theme/theme-switcher'
import { Sidebar } from './sidebar'
import { SignOutButton, WorkspaceSwitcher } from './user-menu'

export function AppShell() {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex h-dvh bg-background">
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border md:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <aside className="relative h-full w-60 border-r border-sidebar-border">
            <div className="flex h-full flex-col">
              <div className="flex-1"><Sidebar onNavigate={() => setOpen(false)} /></div>
              <div className="border-t border-sidebar-border bg-sidebar p-3"><WorkspaceSwitcher /></div>
            </div>
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <div className="hidden md:block">
            <WorkspaceSwitcher />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <ThemeSwitcher />
            <SignOutButton />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
