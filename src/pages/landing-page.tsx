import { ThemeSwitcher } from '@/features/theme/theme-switcher'
import { DispatchSlip } from '@/features/landing/dispatch-slip'
import { FinalCta, Ledger, LoginLink, Setup, Trust } from '@/features/landing/sections'

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}

// Hash routing owns location.hash, so in-page links scroll with JavaScript instead of using #anchors.
function NavLink({ to, children }: { to: string; children: string }) {
  return (
    <button type="button" onClick={() => scrollTo(to)} className="rounded px-1 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </button>
  )
}

export function LandingPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <a href="#/" className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">W</span>
            WorkRelay
          </a>
          <nav aria-label="Page" className="hidden items-center gap-6 md:flex">
            <NavLink to="what-you-get">What you get</NavLink>
            <NavLink to="how-it-works">How it works</NavLink>
            <NavLink to="trust">Trust</NavLink>
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block"><ThemeSwitcher /></div>
            <LoginLink />
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div aria-hidden className="landing-backdrop pointer-events-none absolute inset-0" />
          <div className="relative mx-auto grid max-w-6xl gap-14 px-5 pt-16 pb-20 sm:pt-24 sm:pb-28 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-10">
            <div className="self-center">
              <p className="landing-rise mb-5 font-mono text-[11px] tracking-[0.14em] text-primary uppercase">Order operations for online shops</p>
              <h1 className="landing-rise font-display text-balance text-[2.75rem] leading-[0.98] font-semibold tracking-tight sm:text-6xl lg:text-7xl" style={{ animationDelay: '0.05s' }}>
                Every order, the moment it happens.
              </h1>
              <p className="landing-rise mt-6 max-w-xl text-lg text-muted-foreground" style={{ animationDelay: '0.12s' }}>
                WorkRelay collects orders from your shops, keeps each one organised, and handles the follow-ups for you. A Discord message for a new order. A review for a big one. No spreadsheets, no tab-hopping.
              </p>
              <div className="landing-rise mt-9 flex flex-wrap items-center gap-4" style={{ animationDelay: '0.2s' }}>
                <LoginLink size="lg" />
                <button type="button" onClick={() => scrollTo('how-it-works')} className="rounded text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                  See how it works
                </button>
              </div>
            </div>
            <div className="lg:pl-6">
              <DispatchSlip />
            </div>
          </div>
        </section>

        <Ledger />
        <Setup />
        <Trust />
        <FinalCta />
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-8 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} WorkRelay</span>
          <span className="font-mono text-xs">Order data shown on this page is sample data.</span>
        </div>
      </footer>
    </div>
  )
}
