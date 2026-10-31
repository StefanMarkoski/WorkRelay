import type { ReactNode } from 'react'

/**
 * Colour for the three kinds of code the guide shows: JSON bodies, shell commands and raw HTTP requests. A few rules each, no
 * parser: keys are quiet, strings carry the signal green, comments recede. Anything else is left plain.
 */

const KEY = 'text-white/60'
const STR = 'text-[oklch(0.82_0.1_150)]'
const DIM = 'text-white/45'

function json(line: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?)|\b(true|false|null)\b/g
  let last = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push(line.slice(last, m.index))
    if (m[1] !== undefined) {
      out.push(
        <span key={m.index} className={m[2] ? KEY : STR}>
          {m[1]}
        </span>,
      )
      if (m[2]) out.push(m[2])
    } else {
      out.push(<span key={m.index}>{m[0]}</span>)
    }
    last = m.index + m[0].length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

function shell(line: string): ReactNode[] {
  if (line.trimStart().startsWith('#')) return [<span key="c" className={DIM}>{line}</span>]
  const out: ReactNode[] = []
  const re = /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g
  let last = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push(line.slice(last, m.index))
    out.push(
      <span key={m.index} className={STR}>
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

function http(line: string): ReactNode[] {
  const m = /^(GET|POST|PUT|DELETE)(\s.*)$/.exec(line)
  if (m) return [<span key="m" className={STR}>{m[1]}</span>, m[2]]
  const header = /^([A-Za-z-]+:)(\s.*)$/.exec(line)
  if (header) return [<span key="h" className={KEY}>{header[1]}</span>, header[2]]
  return json(line)
}

export function highlight(text: string, lang: string): ReactNode {
  const pick = lang === 'json' ? json : lang === 'bash' || lang === 'sh' ? shell : http
  return text.split('\n').map((line, i, all) => (
    <span key={i}>
      {pick(line)}
      {i < all.length - 1 ? '\n' : ''}
    </span>
  ))
}
