/**
 * What a failure means, in words a shop owner can act on. The system stores the raw reason (a validator message such as
 * "order.totals.total_minor: Too small: expected number to be >=0", or "HTTP 404"); this turns it into a title, a sentence on why
 * it happened, and what to do. The raw text is always shown next to it, so nothing is hidden. Anything not recognised is shown as
 * it is, with a neutral explanation, rather than guessed at.
 */

export interface Explanation {
  /** The short headline for the row. */
  title: string
  /** Why it happened, in a sentence or two. */
  reason: string
  /** What to do about it. */
  fix: string
}

export type FailureKind = 'event' | 'run'

const quote = (s: string) => `“${s}”`

/** "order.totals.total_minor: Too small…" splits into the field and its message. */
function splitIssue(issue: string): { path: string; message: string } {
  const at = issue.indexOf(': ')
  if (at < 0) return { path: '', message: issue }
  return { path: issue.slice(0, at), message: issue.slice(at + 2) }
}

function describeField(path: string): string {
  if (!path || path === '(root)') return 'the request'
  // products.0.stock reads as "stock of product 1"
  const m = /^products\.(\d+)\.(.+)$/.exec(path)
  if (m) return `${quote(m[2])} of product number ${Number(m[1]) + 1}`
  return quote(path)
}

function explainIssue(path: string, message: string): Explanation {
  const field = describeField(path)
  let m: RegExpExecArray | null

  if ((m = /expected (\w+), received undefined/.exec(message))) {
    return {
      title: `A required field is missing`,
      reason: `${field} is required but was not in what the shop sent.`,
      fix: `Add ${field} to the request. The developer guide lists which fields each event needs.`,
    }
  }
  if (/expected int, received number/.test(message)) {
    return {
      title: 'A number has decimals',
      reason: `${field} must be a whole number, but the shop sent one with decimals.`,
      fix: 'Send amounts as whole numbers in the smallest unit of the currency (49.99 EUR is 4999), and stock as a whole number of pieces.',
    }
  }
  if ((m = /expected (\w+), received (\w+)/.exec(message))) {
    const [, want, got] = m
    return {
      title: 'A value has the wrong type',
      reason: `${field} should be ${want === 'array' ? 'a list' : want === 'object' ? 'an object' : `a ${want}`}, but the shop sent ${got === 'array' ? 'a list' : got === 'object' ? 'an object' : `a ${got}`}.`,
      fix: `Send ${field} as ${want === 'array' ? 'a list' : want === 'object' ? 'an object' : `a ${want}`}${want === 'number' ? ', without quotes' : ''}.`,
    }
  }
  if (/Too small: expected number to be >=\s*0/.test(message)) {
    return {
      title: 'A negative amount was sent',
      reason: `${field} is below zero. Money and quantities cannot be negative here: a refund is shown through the payment status, not as a negative total.`,
      fix: 'Send zero or more. To show a refund, set the order’s payment status to refunded or partially refunded.',
    }
  }
  if (/within the last 7 days/.test(message)) {
    return {
      title: 'The event time is out of range',
      reason: `${field} is the time the event was sent. It must be within the last 7 days and no more than a day ahead, and this one was outside that.`,
      fix: 'Send the current time as occurred_at. To import an older order, send the event now and put the real date in placed_at.',
    }
  }
  if (/between the year 2000/.test(message)) {
    return {
      title: 'A date is out of range',
      reason: `${field} is before the year 2000 or more than a day in the future, so it is almost certainly a mistake.`,
      fix: 'Send the real date. It must be between 2000-01-01 and one day from now.',
    }
  }
  if (/Invalid ISO datetime/.test(message)) {
    return {
      title: 'A date is not in the right format',
      reason: `${field} is not an ISO 8601 date-time with a time zone.`,
      fix: 'Use a format such as 2026-10-27T10:00:00Z or 2026-10-27T10:00:00+02:00.',
    }
  }
  if (/Invalid email/.test(message)) {
    return {
      title: 'An email address is not valid',
      reason: `${field} is not a valid email address. Spaces are not accepted, and capital letters are fine.`,
      fix: 'Send the address trimmed, such as ana@example.com, or leave the field out.',
    }
  }
  if (/must match pattern \/\^\[A-Za-z\]\{3\}\$\//.test(message)) {
    return {
      title: 'A currency code is not valid',
      reason: `${field} must be a three-letter currency code such as EUR, USD or MKD.`,
      fix: 'Send the three-letter code, not a symbol or a longer name.',
    }
  }
  if ((m = /Too big: expected (\w+) to have <=\s*(\d+)/.exec(message))) {
    return {
      title: 'A value is too long',
      reason: `${field} is longer than the ${m[2]} characters allowed.`,
      fix: `Shorten ${field} to at most ${m[2]} characters.`,
    }
  }
  if (/currency is required with price_minor/.test(message)) {
    return {
      title: 'A price has no currency',
      reason: `${field}: a product that has a price must also say which currency it is in.`,
      fix: 'Add the three-letter currency next to price_minor, or leave the price out.',
    }
  }
  return {
    title: 'The event did not match the expected format',
    reason: `${field}: ${message}`,
    fix: 'Compare the request with the examples in the developer guide.',
  }
}

/** A failed incoming event: the reason is one of WorkRelay's own codes, or the validator's list of problems. */
function explainEvent(error: string | null): Explanation {
  const e = (error ?? '').trim()
  if (!e) {
    return {
      title: 'The event failed',
      reason: 'WorkRelay did not record why.',
      fix: 'Send it again. If it fails the same way, contact WorkRelay with the event id.',
    }
  }
  if (e === 'malformed_json' || /^unparseable/.test(e)) {
    return {
      title: 'The body was not valid JSON',
      reason: 'WorkRelay could not read what the shop sent as JSON. It may be empty, cut short, or have a stray comma or missing quote.',
      fix: 'Send a JSON body with the header Content-Type: application/json, and check it parses before sending.',
    }
  }
  if (e === 'payload_too_large') {
    return {
      title: 'The request was too large',
      reason: 'The body is bigger than the 1 MB WorkRelay accepts in one request.',
      fix: 'Send fewer items per request. For products, send up to 500 per request, one after the other.',
    }
  }
  if (e === 'internal error') {
    return {
      title: 'WorkRelay hit an error saving this',
      reason: 'This is on WorkRelay’s side, not a mistake in what the shop sent.',
      fix: 'Send the same event again, which is safe to repeat. If it keeps failing, contact WorkRelay with the event id.',
    }
  }
  if (e === 'concurrent update conflict') {
    return {
      title: 'Two updates to the same order collided',
      reason: 'Two events for the same order arrived at the same moment and WorkRelay gave up after retrying.',
      fix: 'Send the event again, which is safe to repeat.',
    }
  }
  const issues = e.replace(/^invalid_envelope:\s*/, '').split('; ').filter(Boolean)
  const first = splitIssue(issues[0] ?? e)
  const one = explainIssue(first.path, first.message)
  if (issues.length > 1) {
    one.reason += ` ${issues.length - 1} more ${issues.length === 2 ? 'problem was' : 'problems were'} found; the full list is in the details.`
  }
  return one
}

/** The destination's answer (HTTP 404, a timeout…) in words. */
function explainDestination(raw: string): { what: string; fix: string } {
  let m: RegExpExecArray | null
  if ((m = /^HTTP (\d{3})$/.exec(raw))) {
    const code = Number(m[1])
    if (code === 401 || code === 403) return { what: `refused the message (HTTP ${code}): it does not accept this address or key`, fix: 'Check the webhook URL and any key in it. Create a new webhook at the destination and paste its URL into the automation.' }
    if (code === 404 || code === 410) return { what: `no longer exists at that address (HTTP ${code})`, fix: 'The webhook was probably deleted or mistyped. Create a new one at the destination and update the automation’s URL.' }
    if (code === 429) return { what: 'asked WorkRelay to slow down (HTTP 429)', fix: 'This is temporary. The next run will try again; if it keeps happening, send fewer messages to this destination.' }
    if (code >= 500) return { what: `had a problem of its own (HTTP ${code})`, fix: 'This is on the destination’s side. It usually clears by itself; open the run to try again later.' }
    return { what: `rejected the message (HTTP ${code})`, fix: 'Check what the automation sends against what the destination expects, and the URL it sends to.' }
  }
  if (/timeout|timed out|fetch failed|ECONN|ENOTFOUND|network|DNS|certificate/i.test(raw)) {
    return { what: `could not be reached (${raw})`, fix: 'Check that the address is correct and the destination is online.' }
  }
  return { what: `failed with: ${raw}`, fix: 'Open the run to see the step that failed.' }
}

/** A failed automation run: the engine writes the step's name and the destination's answer into one line. */
function explainRun(error: string | null): Explanation {
  const e = (error ?? '').trim()
  if (!e) return { title: 'The automation run failed', reason: 'WorkRelay did not record why.', fix: 'Open the run to see its steps.' }
  let m: RegExpExecArray | null
  if ((m = /^Step "(.*)" failed after (\d+) attempts: (.*)$/.exec(e))) {
    const d = explainDestination(m[3])
    return { title: `The step ${quote(m[1])} kept failing`, reason: `WorkRelay tried ${m[2]} times and the destination ${d.what}.`, fix: d.fix }
  }
  if ((m = /^Step "(.*)" failed: (.*)$/.exec(e))) {
    const d = explainDestination(m[2])
    return { title: `The step ${quote(m[1])} failed`, reason: `The destination ${d.what}.`, fix: d.fix }
  }
  if ((m = /^Destination blocked: (.*)$/.exec(e))) {
    return { title: 'WorkRelay would not send to that address', reason: `The step’s address is not allowed (${m[1]}). WorkRelay never sends to private, internal or local addresses.`, fix: 'Use a public https address.' }
  }
  if (e === 'Approval was rejected') {
    return { title: 'A person rejected the approval', reason: 'The run waited for an approval and it was declined, so it stopped. This is a decision, not a fault.', fix: 'Nothing to fix. If it was declined by mistake, the order can be handled by hand.' }
  }
  if (e === 'Execution timed out') {
    return { title: 'The run took too long', reason: 'It did not finish inside the time a run is allowed.', fix: 'Open the run to see which step was slow, and check that destination.' }
  }
  if (/^Workflow definition is invalid/.test(e) || /^Unknown step/.test(e)) {
    return { title: 'The automation’s settings are no longer valid', reason: e, fix: 'Open the automation, check its steps, and save it again.' }
  }
  if (/^Email delivery is unavailable/.test(e)) {
    return { title: 'Email is not available yet', reason: 'The automation tried to send an email, but WorkRelay has no email provider set up.', fix: 'Use a Discord, Slack or webhook step instead for now.' }
  }
  if (e === 'Recorded as failed by the workflow') {
    return { title: 'The automation recorded a failure on purpose', reason: 'One of its steps was set to mark the run as failed.', fix: 'Nothing to fix unless that was not intended: check the automation’s steps.' }
  }
  return { title: 'The automation run failed', reason: e, fix: 'Open the run to see which step failed.' }
}

export function explainFailure(kind: FailureKind, error: string | null): Explanation {
  return kind === 'event' ? explainEvent(error) : explainRun(error)
}
