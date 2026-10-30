/** How many decimals the currency's minor unit has (2 for EUR, 0 for JPY, 3 for KWD). */
function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

export function formatMoney(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor == null) return '—'
  if (!currency) return `${(minor / 100).toFixed(2)} (no currency)`
  const digits = minorDigits(currency)
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 10 ** digits)
  } catch {
    return `${(minor / 10 ** digits).toFixed(digits)} ${currency}`
  }
}

/** Order value per currency, e.g. "€10.00 · ¥5,000". Currencies are never added together. */
export function formatSpent(spent: Record<string, number> | null | undefined): string {
  const parts = Object.entries(spent ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, minor]) => formatMoney(minor, currency))
  return parts.length ? parts.join(' · ') : '—'
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso))
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const units: [number, string][] = [[60, 'm'], [3600, 'h'], [86400, 'd']]
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  void units
  return `${Math.floor(s / 86400)}d ago`
}

export function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

export const humanize = (v: string) => v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
