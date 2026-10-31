import type { ReactNode } from 'react'
import { BrandMark } from '@/components/common/brand-mark'
import { useAuth } from '@/features/auth/auth-provider'
import { ThemeSwitcher } from '@/features/theme/theme-switcher'
import { cn } from '@/lib/utils'
import { LoginLink } from './sections'

export const navItemClass = 'rounded px-1 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:text-foreground'

/** The bar shared by the signed-out pages (the landing page and the Dev Docs): wordmark, the page's own links, theme, and the way in. */
export function PublicHeader({ nav }: { nav: ReactNode }) {
  const { session } = useAuth()
  return (
    <header className="sticky top-0 z-30 border-b bg-background">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-6">
        <a href="#/" className="flex items-center gap-3 font-display text-lg font-semibold tracking-tight">
          <BrandMark />
          WorkRelay
        </a>
        <nav aria-label="Page" className="hidden items-center gap-6 md:flex">
          {nav}
        </nav>
        <div className="flex items-center gap-3">
          <div className="hidden sm:block">
            <ThemeSwitcher />
          </div>
          {/* someone who is already signed in goes back to the app, not to a login form */}
          <LoginLink href={session ? '#/' : undefined} className={cn('h-10 sm:h-8')}>{session ? 'Open WorkRelay' : 'Log in'}</LoginLink>
        </div>
      </div>
    </header>
  )
}
