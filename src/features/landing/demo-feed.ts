import { useEffect, useState } from 'react'

/** The relay unit is a grid of connection channels. Everything the landing page shows on it is sample data. */
export const UNIT_COLS = 8
export const UNIT_ROWS = 4
export const UNIT_CHANNELS = UNIT_COLS * UNIT_ROWS

export interface FeedEvent {
  /** Increases for every event so React keys stay unique as the list scrolls. */
  seq: number
  order: string
  text: string
  channel: number
}

const SCRIPT: { text: string; channel: number }[] = [
  { text: 'received', channel: 2 },
  { text: 'Discord notified', channel: 2 },
  { text: 'received', channel: 13 },
  { text: 'held for approval', channel: 13 },
  { text: 'received', channel: 21 },
  { text: 'Slack notified', channel: 21 },
  { text: 'received', channel: 6 },
  { text: 'received', channel: 26 },
  { text: 'Discord notified', channel: 26 },
  { text: 'received', channel: 17 },
]

/** How long a packet takes from the shop to the unit. The scene and the feed both read this so they land together. */
export const PACKET_TRAVEL_MS = 1500
const STEP_MS = 1900
const HOLD_MS = 2600
const VISIBLE_EVENTS = 3
const FIRST_ORDER = 1042

function eventAt(seq: number): FeedEvent {
  const s = SCRIPT[seq % SCRIPT.length]
  // Every received/notified pair belongs to one order, so the number advances on each "received".
  const orders = SCRIPT.slice(0, (seq % SCRIPT.length) + 1).filter((e) => e.text === 'received').length
  const cycle = Math.floor(seq / SCRIPT.length) * SCRIPT.filter((e) => e.text === 'received').length
  return { seq, order: `#${FIRST_ORDER + cycle + orders - 1}`, text: s.text, channel: s.channel }
}

export interface Launch {
  seq: number
  channel: number
}

/**
 * Lit lamp indices, the latest events, and the packet the shop has just sent.
 * An order's "received" event and its lamp only appear once its packet has travelled to the unit; follow-ups
 * (a notification, an approval hold) start at the unit, so they appear at once. With reduced motion the unit shows one fixed moment.
 */
export function useDemoFeed(reducedMotion: boolean) {
  const [state, setState] = useState(() => {
    const events = [eventAt(2), eventAt(3), eventAt(4)].reverse()
    return { events, lit: new Set<number>([13, 21]) }
  })
  const [launch, setLaunch] = useState<Launch | null>(null)

  useEffect(() => {
    if (reducedMotion) return
    let seq = 4
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
      if (next.text === 'received') {
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
