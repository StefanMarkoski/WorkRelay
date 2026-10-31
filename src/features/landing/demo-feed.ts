import { useEffect, useState } from 'react'

/** The relay unit is a grid of connection channels. Everything the landing page shows on it is sample data. */
export const UNIT_COLS = 8
export const UNIT_ROWS = 4
export const UNIT_CHANNELS = UNIT_COLS * UNIT_ROWS

export interface FeedEvent {
  /** Increases for every event so React keys stay unique as the list scrolls. */
  seq: number
  /** What the event is about: an order number, a product, a shop or a person. */
  subject: string
  text: string
  channel: number
  /** True when the shop sent it, so a packet travels from the shop to the unit first. */
  inbound: boolean
}

/**
 * One turn of the sample feed. `subject: null` means "the current order": its number advances on every `newOrder`,
 * and the follow-ups after it (a notification, an approval hold) belong to that order.
 */
const SCRIPT: { subject: string | null; text: string; channel: number; inbound?: boolean; newOrder?: boolean }[] = [
  { subject: null, text: 'received', channel: 2, inbound: true, newOrder: true },
  { subject: null, text: 'Discord notified', channel: 2 },
  { subject: 'TEE-BLK-M', text: 'low stock: 4 left', channel: 13, inbound: true },
  { subject: 'TEE-BLK-M', text: 'Slack notified', channel: 13 },
  { subject: null, text: 'received', channel: 21, inbound: true, newOrder: true },
  { subject: null, text: 'held for approval', channel: 21 },
  { subject: 'Ana P.', text: 'signed up', channel: 6, inbound: true },
  { subject: 'Game Store', text: 'synced 240 products', channel: 26, inbound: true },
  { subject: null, text: 'received', channel: 17, inbound: true, newOrder: true },
  { subject: null, text: 'Discord notified', channel: 17 },
]
const ORDERS_PER_CYCLE = SCRIPT.filter((e) => e.newOrder).length

/** How long a packet takes from the shop to the unit. The scene and the feed both read this so they land together. */
export const PACKET_TRAVEL_MS = 1500
const STEP_MS = 1900
const HOLD_MS = 2600
const VISIBLE_EVENTS = 3
const FIRST_ORDER = 1042

function eventAt(seq: number): FeedEvent {
  const s = SCRIPT[seq % SCRIPT.length]
  // Every received/notified pair belongs to one order, so the number advances on each new order.
  const orders = SCRIPT.slice(0, (seq % SCRIPT.length) + 1).filter((e) => e.newOrder).length
  const cycle = Math.floor(seq / SCRIPT.length) * ORDERS_PER_CYCLE
  return { seq, subject: s.subject ?? `#${FIRST_ORDER + cycle + orders - 1}`, text: s.text, channel: s.channel, inbound: s.inbound === true }
}

export interface Launch {
  seq: number
  channel: number
}

/**
 * Lit lamp indices, the latest events, and the packet the shop has just sent.
 * Whatever the shop sends (an order, a stock report, a signup, a product sync) only appears once its packet has travelled to the unit;
 * follow-ups (a notification, an approval hold) start at the unit, so they appear at once. With reduced motion the unit shows one fixed moment.
 */
export function useDemoFeed(reducedMotion: boolean) {
  const [state, setState] = useState(() => {
    const events = [eventAt(3), eventAt(4), eventAt(5)].reverse()
    return { events, lit: new Set<number>([13, 21]) }
  })
  const [launch, setLaunch] = useState<Launch | null>(null)

  useEffect(() => {
    if (reducedMotion) return
    let seq = 5
    const timers = new Set<number>()
    const later = (fn: () => void, ms: number) => {
      const t = window.setTimeout(() => {
        timers.delete(t)
        fn()
      }, ms)
      timers.add(t)
    }
    const tick = () => {
      seq += 1
      const next = eventAt(seq)
      const arrive = () => {
        setState((prev) => ({
          events: [next, ...prev.events].slice(0, VISIBLE_EVENTS),
          lit: new Set(prev.lit).add(next.channel),
        }))
        later(() => {
          setState((prev) => {
            const lit = new Set(prev.lit)
            lit.delete(next.channel)
            return { events: prev.events, lit }
          })
        }, HOLD_MS)
      }
      if (next.inbound) {
        setLaunch({ seq: next.seq, channel: next.channel })
        later(arrive, PACKET_TRAVEL_MS)
      } else {
        arrive()
      }
    }
    const id = window.setInterval(tick, STEP_MS)
    return () => {
      window.clearInterval(id)
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [reducedMotion])

  return { ...state, launch }
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return reduced
}
