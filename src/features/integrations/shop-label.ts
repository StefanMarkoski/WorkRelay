/** A shop's name with the one currency it sells in: "Game Store (MKD)". Without a currency yet, just the name. */
export const shopLabel = (s: { name: string; currency?: string | null }) => (s.currency ? `${s.name} (${s.currency})` : s.name)
