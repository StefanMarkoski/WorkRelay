/**
 * A small markdown reader for the developer guide. It reads only what the guide uses (headings, paragraphs, lists with nested
 * blocks, task lists, tables, fenced code, and bold / italic / code / links inside text), so the guide stays one plain file that
 * reads well on GitHub and is the single source for the docs page. Anything else is shown as ordinary text, never dropped.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }

export interface ListItem {
  /** Set for "- [ ] " and "- [x] " items. */
  task?: { checked: boolean }
  inline: Inline[]
  /** Blocks nested under the item (a code block, a second paragraph, a sub-list). */
  blocks: Block[]
}

export type Block =
  | { t: 'heading'; level: number; id: string; text: string; inline: Inline[] }
  | { t: 'para'; inline: Inline[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }

/** "3. Start here: the order webhook" becomes "start-here-the-order-webhook". */
export function slugify(text: string): string {
  return text
    .replace(/^\d+\.\s+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// ---------------------------------------------------------------------------------------------------- inline

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf })
    buf = ''
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i) {
        flush()
        out.push({ t: 'code', v: src.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (ch === '*' && src[i + 1] === '*') {
      const end = findClose(src, i + 2, '**')
      if (end > i + 2) {
        flush()
        out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    if (ch === '*' && src[i + 1] !== '*' && src[i + 1] !== ' ') {
      const end = findClose(src, i + 1, '*')
      if (end > i + 1) {
        flush()
        out.push({ t: 'em', c: parseInline(src.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }
    if (ch === '[') {
      const m = /^\[((?:[^\]`]|`[^`]*`)+)\]\(([^)\s]+)\)/.exec(src.slice(i))
      if (m) {
        flush()
        out.push({ t: 'link', href: m[2], c: parseInline(m[1]) })
        i += m[0].length
        continue
      }
    }
    buf += ch
    i += 1
  }
  flush()
  return out
}

/** The index of the next `marker` that is not inside a code span. */
function findClose(src: string, from: number, marker: string): number {
  let i = from
  while (i < src.length) {
    if (src[i] === '`') {
      const end = src.indexOf('`', i + 1)
      if (end < 0) return -1
      i = end + 1
      continue
    }
    if (src.startsWith(marker, i)) {
      // "**" must not be read as the end of a single "*"
      if (marker === '*' && src[i + 1] === '*') {
        i += 2
        continue
      }
      return i
    }
    i += 1
  }
  return -1
}

// ---------------------------------------------------------------------------------------------------- blocks

const FENCE = /^(\s*)```(\w*)\s*$/
const HEADING = /^(#{1,6})\s+(.*?)\s*$/
const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/
const TABLE_SEP = /^\s*\|?[\s:|-]+\|[\s:|-]*$/

const indentOf = (line: string) => line.length - line.trimStart().length

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  let inCode = false
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i]
    if (c === '`') inCode = !inCode
    if (c === '|' && !inCode && trimmed[i - 1] !== '\\') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += c
    }
  }
  cells.push(cell.trim())
  return cells
}

export function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i += 1
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i].startsWith(fence[1]) ? lines[i].slice(fence[1].length) : lines[i])
        i += 1
      }
      i += 1 // the closing fence
      blocks.push({ t: 'code', lang: fence[2], text: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      const text = heading[2].replace(/`/g, '')
      blocks.push({ t: 'heading', level: heading[1].length, id: slugify(text), text, inline: parseInline(heading[2]) })
      i += 1
      continue
    }

    if (line.trimStart().startsWith('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = splitRow(line).map(parseInline)
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        rows.push(splitRow(lines[i]).map(parseInline))
        i += 1
      }
      blocks.push({ t: 'table', head, rows })
      continue
    }

    const list = LIST.exec(line)
    if (list) {
      const base = list[1].length
      const ordered = /\d/.test(list[2])
      const start = ordered ? parseInt(list[2], 10) : 1
      const items: ListItem[] = []
      while (i < lines.length) {
        const m = LIST.exec(lines[i])
        if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break
        const width = m[1].length + m[2].length + 1
        const body: string[] = [m[3]]
        i += 1
        // Everything after the marker that is indented under it belongs to this item, blank lines included.
        while (i < lines.length) {
          const next = lines[i]
          if (next.trim() === '') {
            let j = i
            while (j < lines.length && lines[j].trim() === '') j += 1
            if (j < lines.length && indentOf(lines[j]) > base) {
              body.push('')
              i += 1
              continue
            }
            break
          }
          if (indentOf(next) > base) {
            body.push(next.slice(Math.min(width, indentOf(next))))
            i += 1
            continue
          }
          break
        }
        const [first, ...rest] = body
        const task = /^\[( |x|X)\]\s+/.exec(first)
        const text = task ? first.slice(task[0].length) : first
        // The first lines (up to a blank line or a nested block) are the item's own text.
        let split = 0
        while (split < rest.length && rest[split].trim() !== '' && !FENCE.test(rest[split]) && !LIST.test(rest[split])) split += 1
        const own = [text, ...rest.slice(0, split)].join(' ')
        items.push({ task: task ? { checked: task[1] !== ' ' } : undefined, inline: parseInline(own), blocks: parseBlocks(rest.slice(split)) })
        // a blank line between items of the same list does not end it
        let k = i
        while (k < lines.length && lines[k].trim() === '') k += 1
        const after = k < lines.length ? LIST.exec(lines[k]) : null
        if (after && after[1].length === base && /\d/.test(after[2]) === ordered) i = k
      }
      blocks.push({ t: 'list', ordered, start, items })
      continue
    }

    // a paragraph runs to the next blank line, or to the start of another block
    const para: string[] = [line.trim()]
    i += 1
    while (i < lines.length && lines[i].trim() !== '' && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !LIST.test(lines[i]) && !lines[i].trimStart().startsWith('|')) {
      para.push(lines[i].trim())
      i += 1
    }
    blocks.push({ t: 'para', inline: parseInline(para.join(' ')) })
  }
  return blocks
}

export function parseMarkdown(src: string): Block[] {
  return parseBlocks(src.replace(/\r\n/g, '\n').split('\n'))
}

/** The plain text of some inline content, for the table of contents and tests. */
export function inlineText(inline: Inline[]): string {
  return inline.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : inlineText(n.c))).join('')
}
