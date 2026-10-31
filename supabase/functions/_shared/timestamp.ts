import { z } from 'zod'

/**
 * A moment sent by a shop. It must be a real ISO 8601 time with an offset, no earlier than the year 2000 and no more than a day
 * ahead of now (a day allows for a shop whose clock runs fast). Anything outside that is a typo or a test value, and would
 * otherwise sort to the top of the order list forever or distort the charts, so the webhook refuses it.
 */
export const EARLIEST_TIMESTAMP = '2000-01-01T00:00:00Z'
export const MAX_AHEAD_MS = 24 * 60 * 60 * 1000

export const timestamp = z.iso.datetime({ offset: true }).refine(
  (v) => {
    const t = Date.parse(v)
    return t >= Date.parse(EARLIEST_TIMESTAMP) && t <= Date.now() + MAX_AHEAD_MS
  },
  { message: 'must be between the year 2000 and one day from now' },
)

export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The time an event was sent. Events are live, so it is held to a tighter window than the other times: no older than a week
 * (room for a shop that retries after an outage) and no more than a day ahead. The real date of an old order goes in `placed_at`.
 */
export const eventTimestamp = z.iso.datetime({ offset: true }).refine(
  (v) => {
    const t = Date.parse(v)
    return t >= Date.now() - MAX_AGE_MS && t <= Date.now() + MAX_AHEAD_MS
  },
  { message: 'must be within the last 7 days and no more than one day from now' },
)
