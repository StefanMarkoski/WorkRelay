import { Suspense, lazy, useCallback, useState } from "react";
import { ThemeSwitcher } from "@/features/theme/theme-switcher";
import {
  useDemoFeed,
  usePrefersReducedMotion,
} from "@/features/landing/demo-feed";
import { RelayUnitFlat } from "@/features/landing/relay-unit-flat";
import { Modules } from "@/features/landing/modules";
import { PublicHeader, navItemClass } from "@/features/landing/public-header";
import {
  DevDocs,
  FinalCta,
  Ledger,
  LoginLink,
  Setup,
  Trust,
} from "@/features/landing/sections";

// Three.js is its own chunk: the page is readable and the flat unit is on screen before it arrives.
const RelayUnit = lazy(() => import("@/features/landing/relay-unit"));

function scrollTo(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
}

// Hash routing owns location.hash, so in-page links scroll with JavaScript instead of using #anchors.
function NavLink({ to, children }: { to: string; children: string }) {
  return (
    <button
      type="button"
      onClick={() => scrollTo(to)}
      className={navItemClass}
    >
      {children}
    </button>
  );
}

function Instrument() {
  const reduced = usePrefersReducedMotion();
  const { events, lit, launch } = useDemoFeed(reduced);
  const [webglFailed, setWebglFailed] = useState(false);
  const unavailable = useCallback(() => setWebglFailed(true), []);
  const flat = <RelayUnitFlat lit={lit} />;

  return (
    <figure aria-label="Sample events travelling from a shop to a relay unit">
      {webglFailed ? (
        flat
      ) : (
        <Suspense fallback={flat}>
          <RelayUnit
            lit={lit}
            launch={launch}
            reducedMotion={reduced}
            onUnavailable={unavailable}
          />
        </Suspense>
      )}
      <figcaption>
        <p className="mt-6 text-xs text-muted-foreground">
          Sample feed: invented events, shown to explain how an order, a stock report or a signup travels.
        </p>
        <ul
          aria-label="Sample events"
          className="mt-2 divide-y border-y font-mono text-[13px]"
        >
          {events.map((e) => (
            <li key={e.seq} className="tnum flex items-center gap-4 py-3">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full bg-primary"
              />
              <span className="w-24 shrink-0 truncate text-foreground">{e.subject}</span>
              <span className="min-w-0 truncate text-muted-foreground">{e.text}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

export function LandingPage() {
  return (
    <div className="world min-h-dvh">
      <PublicHeader
        nav={
          <>
            <NavLink to="what-you-get">What you get</NavLink>
            <NavLink to="how-it-works">How it works</NavLink>
            <a href="#/docs" className={navItemClass}>
              Dev Docs
            </a>
            <NavLink to="trust">Trust</NavLink>
          </>
        }
      />

      <main>
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="landing-grid pointer-events-none absolute inset-0"
          />
          <div className="relative mx-auto grid max-w-[1200px] items-center gap-12 px-6 pt-14 pb-20 sm:pt-20 sm:pb-28 lg:grid-cols-12 lg:gap-8">
            <div className="lg:col-span-5">
              <h1 className="world-rise font-display text-balance text-[2.75rem] leading-[0.98] font-semibold tracking-[-0.03em] sm:text-6xl lg:text-[4.25rem]">
                Your shop, the moment it happens.
              </h1>
              <p
                className="world-rise mt-6 max-w-[42ch] text-lg text-muted-foreground"
                style={{ "--i": 1 } as React.CSSProperties}
              >
                Orders, stock and customers in one live view. Connect any custom
                shop with a single webhook, and WorkRelay keeps it organised and
                tells your team what needs attention.
              </p>
              <div
                className="world-rise mt-10 flex flex-wrap items-center gap-6"
                style={{ "--i": 2 } as React.CSSProperties}
              >
                <LoginLink size="lg">Log in</LoginLink>
                <button
                  type="button"
                  onClick={() => scrollTo("how-it-works")}
                  className="rounded text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  See how it works
                </button>
              </div>
            </div>
            <div
              className="world-rise lg:col-span-7"
              style={{ "--i": 3 } as React.CSSProperties}
            >
              <Instrument />
            </div>
          </div>
        </section>

        <Modules />
        <Ledger />
        <Setup />
        <DevDocs />
        <Trust />
        <FinalCta />
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-6 py-8 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} WorkRelay</span>
          <span className="font-mono text-xs">
            Everything shown on this page is sample data.
          </span>
          <div className="sm:hidden">
            <ThemeSwitcher />
          </div>
        </div>
      </footer>
    </div>
  );
}
