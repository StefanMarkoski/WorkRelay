import type { Integration } from '@/types/db'

const SLOTS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'] as const

/** The neutral used for "Other" and for any shop past the sixth: a ninth hue would only blur two of the others. */
export const OTHER_COLOR = 'var(--series-other)'

/**
 * A shop keeps its colour for good: it follows the shop (by the order it was connected), never its rank in a chart, so
 * filtering or re-sorting never repaints the others. Shops past the sixth share the neutral.
 */
export function shopColor(id: string, shops: Pick<Integration, 'id' | 'created_at'>[]): string {
  const order = [...shops].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  const i = order.findIndex((s) => s.id === id)
  return i >= 0 && i < SLOTS.length ? SLOTS[i] : OTHER_COLOR
}
