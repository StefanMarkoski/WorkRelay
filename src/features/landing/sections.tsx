import { ArrowRight, Check } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const LOGIN_HREF = '#/login'

export function LoginLink({ className, children = 'Continue with log in', size = 'default' }: { className?: string; children?: React.ReactNode; size?: 'default' | 'lg' }) {
  return (
    <a href={LOGIN_HREF} className={cn(buttonVariants({ size }), 'font-medium', className)}>
      {children}
      <ArrowRight data-icon="inline-end" />
    </a>
  )
}

const Eyebrow = ({ children }: { children: string }) => (
  <p className="mb-3 font-mono text-[11px] tracking-[0.14em] text-primary uppercase">{children}</p>
)

const H2 = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <h2 className={cn('font-display text-balance text-3xl leading-[1.05] font-semibold tracking-tight sm:text-4xl', className)}>{children}</h2>
)

const QUESTIONS: { q: string; a: string }[] = [
  { q: 'Where is order #1042?', a: 'One list for every shop you connect. Search it, filter it, and open any order for its full timeline.' },
  { q: 'What changed, and who changed it?', a: 'Every update is on the record: what the shop reported, and what your team did. The two are never mixed up.' },
  { q: 'Who needs to know?', a: 'Turn on a notification and a message lands in Discord or Slack the second an order arrives or is cancelled.' },
  { q: 'Is this one safe to ship?', a: 'Set an amount and larger orders wait for a person to review them first.' },
  { q: 'Is the screen current?', a: 'It updates itself. New orders and results appear as they happen, with no refresh.' },
  { q: 'Whose data is whose?', a: 'Every business is walled off from every other, and the rule is enforced in the database itself.' },
]

export function Ledger() {
  return (
    <section id="what-you-get" aria-labelledby="ledger-title" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:py-28">
      <Eyebrow>What you get</Eyebrow>
      <H2 className="max-w-2xl" >
        <span id="ledger-title">The questions you ask about orders all day. Answered.</span>
      </H2>
      <dl className="mt-12 divide-y border-y">
        {QUESTIONS.map(({ q, a }) => (
          <div key={q} className="grid gap-2 py-6 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-10">
            <dt className="font-display text-xl font-medium tracking-tight sm:text-2xl">{q}</dt>
            <dd className="text-muted-foreground">{a}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const STEPS = [
  { t: 'Create a connection', d: 'Name it and WorkRelay gives you a secret key. It is shown once, then only a fingerprint is kept.' },
  { t: 'Paste it into your shop', d: 'Your shop sends one HTTPS request per order event. The integration guide covers every field.' },
  { t: 'Turn on an automation', d: 'Pick a ready-made rule. It starts working on the very next order.' },
]

export function Setup() {
  return (
    <section id="how-it-works" aria-labelledby="setup-title" className="scroll-mt-20 border-y bg-muted/30">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:py-28 lg:grid-cols-2 lg:gap-16">
        <div>
          <Eyebrow>How it works</Eyebrow>
          <H2><span id="setup-title">Connect a shop in three steps.</span></H2>
          <p className="mt-4 max-w-md text-muted-foreground">If your shop can send a webhook, it can connect. Custom-built shops need no extra software.</p>
          <ol className="mt-10 space-y-7">
            {STEPS.map((s, i) => (
              <li key={s.t} className="flex gap-4">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border font-mono text-xs text-muted-foreground">{i + 1}</span>
                <div>
                  <h3 className="font-display text-lg font-medium">{s.t}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="self-center">
          <p className="mb-2 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">For the developer</p>
          <pre className="overflow-x-auto rounded-xl border border-white/10 bg-[oklch(0.17_0.015_275)] p-5 font-mono text-[12.5px] leading-relaxed text-[oklch(0.86_0.01_275)]">
            <span className="text-[oklch(0.7_0.1_160)]">POST</span> https://…/order-webhook{'\n'}
            <span className="text-[oklch(0.72_0.06_270)]">Authorization:</span> Bearer wr_live_••••••••{'\n'}
            <span className="text-[oklch(0.72_0.06_270)]">X-Store-Id:</span> your-shop{'\n\n'}
            {'{ '}<span className="text-[oklch(0.72_0.06_270)]">"event_type"</span>: <span className="text-[oklch(0.82_0.12_295)]">"order.created"</span>,{'\n'}
            {'  '}<span className="text-[oklch(0.72_0.06_270)]">"order"</span>: {'{ … } }'}
          </pre>
        </div>
      </div>
    </section>
  )
}

const FACTS = [
  { t: 'Every business is walled off.', d: 'Access rules live in the database, not just in hidden buttons.' },
  { t: 'Secret keys are stored hashed.', d: 'A key is shown once. After that, nobody can read it back, only replace it.' },
  { t: 'Repeats are harmless.', d: 'Send the same order event twice and it is recorded once.' },
  { t: 'Nothing disappears quietly.', d: 'Every delivery and every automation run is on the record, errors included.' },
]

export function Trust() {
  return (
    <section id="trust" aria-labelledby="trust-title" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:py-28">
      <Eyebrow>Built to be trusted</Eyebrow>
      <H2 className="max-w-xl"><span id="trust-title">It watches your orders. It never touches your money.</span></H2>
      <ul className="mt-12 grid gap-x-12 gap-y-8 sm:grid-cols-2">
        {FACTS.map((f) => (
          <li key={f.t} className="flex gap-3">
            <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
            <p>
              <span className="font-medium">{f.t}</span>{' '}
              <span className="text-muted-foreground">{f.d}</span>
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-10 max-w-xl text-sm text-muted-foreground">
        WorkRelay reads and reacts. It does not charge cards, issue refunds, or change orders in your shop.
      </p>
    </section>
  )
}

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="px-5 pb-20 sm:pb-28">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 rounded-2xl border bg-card px-7 py-10 sm:flex-row sm:items-center sm:px-12">
        <div>
          <h2 id="cta-title" className="font-display text-balance text-3xl leading-tight font-semibold tracking-tight">Your next order is on its way.</h2>
          <p className="mt-2 text-muted-foreground">Log in and see it arrive.</p>
        </div>
        <LoginLink size="lg" />
      </div>
    </section>
  )
}
