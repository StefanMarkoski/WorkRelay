/** Number scales and formatting shared by the charts. Pure, so they are tested without a browser. */

/** A step of 1, 2, 2.5 or 5 times a power of ten that is at least `raw`. */
function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow
}

/** Clean axis ticks from 0 up to a rounded maximum that covers `max`: [0, 5, 10, 15, 20]. Always at least [0, 1]. */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1]
  const step = niceStep(max / count)
  const top = Math.ceil(max / step - 1e-9) * step
  const ticks: number[] = []
  for (let v = 0; v <= top + step / 1e6; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return ticks
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
/** 950 -> "950", 12400 -> "12.4K", 3200000 -> "3.2M". Used on axes, where space is tight. */
export const formatCompact = (n: number) => compact.format(n)
/** The full number with separators, for tooltips and tables. */
export const formatFull = (n: number) => n.toLocaleString()

/** A percentage of a whole, to a whole number, but never "0%" for something that exists. */
export function percentOf(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return '0%'
  const p = (part / whole) * 100
  return p < 1 ? '<1%' : `${Math.round(p)}%`
}

/** Change against a previous period: "+12%", "-5%", "no change", or null when there was nothing to compare with. */
export function formatDelta(current: number, previous: number): string | null {
  if (previous <= 0) return null
  const d = ((current - previous) / previous) * 100
  if (Math.abs(d) < 0.5) return 'no change'
  return `${d > 0 ? '+' : '-'}${Math.round(Math.abs(d))}%`
}

/**
 * At most `max` slices: the largest stay, the tail folds into one "Other". Never invents a hue past the palette; the
 * fold slice carries the neutral colour.
 */
export function foldSlices<T extends { value: number }>(list: T[], max: number, other: (rest: T[]) => T): T[] {
  const sorted = [...list].sort((a, b) => b.value - a.value)
  if (sorted.length <= max) return sorted
  const head = sorted.slice(0, max - 1)
  return [...head, other(sorted.slice(max - 1))]
}
