/**
 * Currencies a shop can be bound to. A shop sells in exactly one, and nothing in the app converts between them.
 * The short list leads with where WorkRelay's shops are likely to sell; the rest come from the browser's own ISO 4217 list.
 */
export const COMMON_CURRENCIES = ['MKD', 'EUR', 'USD', 'GBP', 'CHF', 'RSD', 'BGN', 'ALL', 'BAM', 'TRY', 'RON', 'HUF', 'PLN', 'CZK'] as const

/** Three upper-case letters, the shape the database accepts. */
export const isCurrencyCode = (v: string) => /^[A-Z]{3}$/.test(v)

/** Every currency the browser knows, sorted, with the common ones removed (they are listed separately above). */
export function otherCurrencies(): string[] {
  let all: string[] = []
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('currency') ?? []
  } catch {
    all = []
  }
  const common = new Set<string>(COMMON_CURRENCIES)
  return all.filter((c) => isCurrencyCode(c) && !common.has(c)).sort()
}

/** "Macedonian denar", or the code itself where the browser has no name for it. */
export function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: 'currency' }).of(code) ?? code
  } catch {
    return code
  }
}

/** "MKD · Macedonian denar" for a select option or a line of text. */
export const currencyLabel = (code: string) => {
  const name = currencyName(code)
  return name === code ? code : `${code} · ${name}`
}
