import { ArrowRight } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { DispatchSlip } from './dispatch-slip'

export const LOGIN_HREF = '#/login'

export function LoginLink({ className, children = 'Continue with log in', size = 'default' }: { className?: string; children?: React.ReactNode; size?: 'default' | 'lg' }) {
  return (
    <a href={LOGIN_HREF} className={cn(buttonVariants({ size }), 'font-medium', size === 'lg' && 'h-11 px-5 text-[0.9375rem]', className)}>
      {children}
      <ArrowRight data-icon="inline-end" />
    </a>
  )
}

/** One lit lamp, used wherever the page needs a bullet. The same part the relay unit is made of. */
function Lamp() {
  return <span aria-hidden className="mt-[0.55em] size-2 shrink-0 rounded-full bg-primary" />
}

const H2 = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <h2 className={cn('font-display text-balance text-3xl leading-[1.05] font-semibold tracking-[-0.025em] sm:text-4xl lg:text-[2.75rem]', className)}>{children}</h2>
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
    <section id="what-you-get" aria-labelledby="ledger-title" className="mx-auto grid max-w-[1200px] scroll-mt-16 gap-12 px-6 py-20 sm:py-28 lg:grid-cols-12 lg:gap-8">
      <div className="lg:col-span-5">
        <H2 className="lg:sticky lg:top-28 lg:max-w-md">
          <span id="ledger-title">The questions you ask about orders all day. Answered.</span>
        </H2>
      </div>
      <dl className="divide-y border-y lg:col-span-7">
        {QUESTIONS.map(({ q, a }) => (
          <div key={q} className="grid gap-2 py-6 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-8">
            <dt className="font-display text-lg font-medium tracking-tight sm:text-xl">{q}</dt>
            <dd className="max-w-[60ch] text-muted-foreground">{a}</dd>
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
    <section id="how-it-works" aria-labelledby="setup-title" className="scroll-mt-16 border-y bg-muted/40">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-12 px-6 py-20 sm:py-28 lg:grid-cols-12 lg:gap-8 [&>div]:min-w-0">
        <div className="lg:col-span-5">
          <H2><span id="setup-title">Connect a shop in three steps.</span></H2>
          <p className="mt-5 max-w-[44ch] text-muted-foreground">If your shop can send a webhook, it can connect. Custom-built shops need no extra software.</p>
          <ol className="mt-12 space-y-8">
            {STEPS.map((s, i) => (
              <li key={s.t} className="flex gap-4">
                <span className="tnum mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border font-mono text-xs text-muted-foreground">{i + 1}</span>
                <div>
                  <h3 className="font-display text-lg font-medium">{s.t}</h3>
                  <p className="mt-1 max-w-[48ch] text-sm text-muted-foreground">{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-sm">
            <a href="https://github.com/StefanMarkoski/WorkRelay/blob/main/documentation/shop-webhook-integration.md" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">Read the integration guide</a>
          </p>
        </div>
        <div className="lg:col-span-6 lg:col-start-7">
          <DispatchSlip />
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
    <section id="trust" aria-labelledby="trust-title" className="mx-auto max-w-[1200px] scroll-mt-16 px-6 py-20 sm:py-28">
      <H2 className="max-w-2xl"><span id="trust-title">It watches your orders. It never touches your money.</span></H2>
      <ul className="mt-14 grid gap-x-16 gap-y-8 sm:grid-cols-2">
        {FACTS.map((f) => (
          <li key={f.t} className="flex gap-4">
            <Lamp />
            <p className="max-w-[48ch]">
              <span className="font-medium">{f.t}</span>{' '}
              <span className="text-muted-foreground">{f.d}</span>
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-12 max-w-[56ch] text-sm text-muted-foreground">
        WorkRelay reads and reacts. It does not charge cards, issue refunds, or change orders in your shop.
      </p>
    </section>
  )
}

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="px-6 pb-20 sm:pb-28">
      <div className="housing mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-8 px-8 py-12 sm:flex-row sm:items-center sm:px-12">
        <div>
          <h2 id="cta-title" className="font-display text-balance text-3xl leading-tight font-semibold tracking-[-0.025em]">Your next order is on its way.</h2>
          <p className="mt-2 text-muted-foreground">Log in and see it arrive.</p>
        </div>
        <LoginLink size="lg">Log in</LoginLink>
      </div>
    </section>
  )
}
