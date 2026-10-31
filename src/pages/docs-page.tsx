import { ArrowRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ThemeSwitcher } from '@/features/theme/theme-switcher'
import { inlineText, parseMarkdown, type Block } from '@/features/docs/markdown'
import { Blocks, CopyButton } from '@/features/docs/render'
import { PublicHeader, navItemClass } from '@/features/landing/public-header'
import guide from '../../documentation/shop-developer-guide.md?raw'

const BLOCKS = parseMarkdown(guide)
const BASE_URL = /Base URL: `([^`]+)`/.exec(guide)?.[1] ?? ''

/** Hash routing owns location.hash, so in-page links scroll with JavaScript instead of using #anchors. */
function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}

/** Where each kind of visitor starts. The ids are the guide's own headings, so a renamed heading fails the docs test, not a reader. */
const PATHS: { id: string; title: string; line: string }[] = [
  { id: 'start-here-the-order-webhook', title: 'Connecting a shop for the first time', line: 'Bind the key and send your first order.' },
  { id: 'customers', title: 'Customers and signup alerts', line: 'How a person is made, and what you send to notify on every signup.' },
  { id: 'inventory', title: 'Stock, and alerts when it runs low', line: 'Let WorkRelay fetch your products, or push them from a button.' },
  { id: 'test-it', title: 'Trying it from a terminal', line: 'Five commands, with what each one should answer.' },
  { id: 'when-something-is-not-showing-up', title: 'Something is not showing up', line: 'Symptoms and their most likely causes.' },
]

function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0] ?? '')
  useEffect(() => {
    const seen = new Map<string, boolean>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting)
        // the first section whose heading is in the top band wins; otherwise keep the last one we passed
        const hit = ids.find((id) => seen.get(id))
        if (hit) setActive(hit)
      },
      { rootMargin: '-80px 0px -70% 0px' },
    )
    ids.forEach((id) => {
      const el = document.getElementById(id)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [ids])
  return active
}

function ContentsList({ sections, active, onPick }: { sections: { id: string; text: string }[]; active: string; onPick?: () => void }) {
  return (
    <ul className="space-y-0.5">
      {sections.map((s) => {
        const on = s.id === active
        return (
          <li key={s.id}>
            <button
              type="button"
              aria-current={on ? 'location' : undefined}
              onClick={() => {
                scrollToId(s.id)
                onPick?.()
              }}
              className="group flex w-full items-start gap-3 rounded py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span aria-hidden className="lamp mt-[0.5em] size-1.5 shrink-0 rounded-full" data-on={on} />
              <span className={on ? 'font-medium text-foreground' : 'text-muted-foreground transition-colors group-hover:text-foreground'}>{s.text}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function splitGuide(blocks: Block[]) {
  const title = blocks.find((b) => b.t === 'heading' && b.level === 1)
  const firstSection = blocks.findIndex((b) => b.t === 'heading' && b.level === 2)
  const startAt = blocks.indexOf(title as Block) + 1
  const intro = blocks.slice(startAt, firstSection).map((b) =>
    // the base URL has its own copy box under the intro, so it is not listed twice
    b.t === 'list' ? { ...b, items: b.items.filter((it) => !inlineText(it.inline).startsWith('Base URL')) } : b,
  )
  const body = blocks.slice(firstSection)
  const sections = body.filter((b): b is Extract<Block, { t: 'heading' }> => b.t === 'heading' && b.level === 2).map((b) => ({ id: b.id, text: b.text }))
  return { title: title && title.t === 'heading' ? title.text : 'Developer guide', intro, body, sections }
}

export default function DocsPage() {
  const { title, intro, body, sections } = useMemo(() => splitGuide(BLOCKS), [])
  const ids = useMemo(() => sections.map((s) => s.id), [sections])
  const active = useActiveSection(ids)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    document.title = `Dev Docs · WorkRelay`
    return () => {
      document.title = 'WorkRelay'
    }
  }, [])

  return (
    <div className="world min-h-dvh">
      <PublicHeader
        nav={
          <>
            <a href="#/" className={navItemClass}>
              Overview
            </a>
            <a href="#/docs" aria-current="page" className={navItemClass}>
              Dev Docs
            </a>
          </>
        }
      />
      <main className="mx-auto max-w-[1200px] px-6 pt-12 pb-24 sm:pt-16 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} className="mb-10 border-y py-3 lg:hidden">
            <summary className="cursor-pointer text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">On this page</summary>
            <div className="mt-3">
              <ContentsList sections={sections} active={active} onPick={() => setOpen(false)} />
            </div>
          </details>
          <nav aria-label="On this page" className="hidden lg:block">
            <p className="mb-3 text-sm font-medium">On this page</p>
            <ContentsList sections={sections} active={active} />
            <p className="mt-8 text-sm text-muted-foreground">
              Every field, status code and limit is in the{' '}
              <a href="https://github.com/StefanMarkoski/WorkRelay/blob/main/documentation/shop-webhook-integration.md" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground">
                full reference
              </a>
              .
            </p>
          </nav>
        </aside>

        <article className="min-w-0">
          <h1 className="max-w-[20ch] font-display text-balance text-[2.5rem] leading-[1.02] font-semibold tracking-[-0.03em] sm:text-5xl">{title}</h1>
          <div className="mt-6 space-y-4 text-lg text-muted-foreground [&_a]:text-foreground [&_p]:max-w-[60ch] [&_strong]:text-foreground">
            <Blocks blocks={intro} />
          </div>

          {BASE_URL && (
            <div className="housing mt-8 flex max-w-xl items-center justify-between gap-3 py-2.5 pr-2 pl-4">
              <div className="min-w-0">
                <p className="font-mono text-[11px] tracking-wide text-muted-foreground">BASE URL</p>
                <p className="truncate font-mono text-[13px]">{BASE_URL}</p>
              </div>
              <CopyButton text={BASE_URL} label="Copy the base URL" />
            </div>
          )}

          <nav aria-label="Where to start" className="mt-12">
            <h2 className="font-display text-xl font-semibold tracking-tight">Where to start</h2>
            <ul className="mt-4 divide-y border-y">
              {PATHS.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => scrollToId(p.id)} className="group flex w-full items-center justify-between gap-4 py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span>
                      <span className="block font-medium">{p.title}</span>
                      <span className="block text-sm text-muted-foreground">{p.line}</span>
                    </span>
                    <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mt-20 space-y-5">
            <Blocks blocks={body} />
          </div>
        </article>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-6 py-8 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} WorkRelay</span>
          <span>Examples in these docs use sample keys and invented data.</span>
          <div className="sm:hidden">
            <ThemeSwitcher />
          </div>
        </div>
      </footer>
    </div>
  )
}
