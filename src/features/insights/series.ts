/**
 * Day buckets for the charts. The server cuts days in the viewer's own time zone and returns only days that had activity;
 * these helpers lay out every day of the range in that same zone and fill the gaps with zero. A day is the string
 * "YYYY-MM-DD", so calendar arithmetic never touches the clock and daylight-saving shifts cannot skip or repeat a day.
 */

export const RANGES = [7, 30, 90] as const
export type RangeDays = (typeof RANGES)[number]

/** The viewer's IANA zone, or UTC where the browser does not say. */
export function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Today's date in a zone, as "YYYY-MM-DD". */
export function todayKey(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '01'
  return `${get('year')}-${get('month')}-${get('day')}`
}

const utc = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function addDays(key: string, delta: number): string {
  return new Date(utc(key) + delta * 86_400_000).toISOString().slice(0, 10)
}

/** `n` consecutive days ending on `endKey`, oldest first. */
export function dayKeys(endKey: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(endKey, i - (n - 1)))
}

/** The zone's offset from UTC at an instant, in ms (positive east of UTC). */
function offsetAt(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(ms / 1000) * 1000
}

/**
 * The real instant a calendar day begins in a zone (its local midnight), for the server's lower bound, so "the last 30
 * days" starts exactly where the day buckets start. Re-checked at the corrected instant so a clock change does not skew it.
 */
export function startOfDay(key: string, tz: string): Date {
  const guess = utc(key)
  const first = guess - offsetAt(guess, tz)
  return new Date(guess - offsetAt(first, tz))
}

/** One number per day: rows are summed into their day, days with no row get 0, rows outside the days are ignored. */
export function fillSeries<T extends { day: string }>(rows: T[], keys: string[], pick: (row: T) => number): number[] {
  const at = new Map(keys.map((k, i) => [k, i]))
  const out = Array<number>(keys.length).fill(0)
  for (const r of rows) {
    const i = at.get(r.day)
    if (i !== undefined) out[i] += pick(r)
  }
  return out
}

/** "Oct 3" (or "3 Oct", by the viewer's locale), from a day key. */
export function formatDay(key: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' }).format(new Date(utc(key)))
}

/** "Fri, Oct 3". */
export const formatDayLong = (key: string) => formatDay(key, { weekday: 'short', month: 'short', day: 'numeric' })

export const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0)
