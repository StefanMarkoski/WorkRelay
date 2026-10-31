import { Check, Copy } from 'lucide-react'
import { Fragment, useState } from 'react'
import { cn } from '@/lib/utils'
import { highlight } from './highlight'
import { inlineText, type Block, type Inline, type ListItem } from './markdown'

/** The guide links to its sibling files with relative paths; on the site they are the files in the repository. */
export const DOCS_BASE = 'https://github.com/StefanMarkoski/WorkRelay/blob/main/documentation/'

export function resolveHref(href: string): { href: string; external: boolean } {
  if (href.startsWith('./')) return { href: DOCS_BASE + href.slice(2), external: true }
  return { href, external: /^https?:/.test(href) }
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <Fragment key={i}>{n.v}</Fragment>
          case 'code':
            return (
              <code key={i} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.86em] break-words text-foreground">
                {n.v}
              </code>
            )
          case 'strong':
            return (
              <strong key={i} className="font-semibold text-foreground">
                <Inlines nodes={n.c} />
              </strong>
            )
          case 'em':
            return (
              <em key={i}>
                <Inlines nodes={n.c} />
              </em>
            )
          case 'link': {
            const { href, external } = resolveHref(n.href)
            return (
              <a
                key={i}
                href={href}
                {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Inlines nodes={n.c} />
              </a>
            )
          }
        }
      })}
    </>
  )
}

const LANG_LABEL: Record<string, string> = { json: 'JSON', bash: 'SHELL', sh: 'SHELL', '': 'HTTP' }

export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [done, setDone] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      window.setTimeout(() => setDone(false), 1600)
    } catch {
      // clipboard blocked: the text is still selectable
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-2 font-mono text-[11px] tracking-wide text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]',
        className,
      )}
    >
      {done ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {done ? 'COPIED' : 'COPY'}
      <span className="sr-only" role="status">
        {done ? 'Copied to the clipboard' : ''}
      </span>
    </button>
  )
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  return (
    <figure className="housing my-0 overflow-hidden">
      <figcaption className="flex items-center justify-between pr-2 pl-4 font-mono text-[11px] tracking-wide text-muted-foreground">
        <span aria-hidden>{LANG_LABEL[lang] ?? lang.toUpperCase()}</span>
        <CopyButton text={text} label={`Copy this ${LANG_LABEL[lang] ?? lang} example`} />
      </figcaption>
      <pre tabIndex={0} className="overflow-x-auto px-4 pt-1 pb-4 font-mono text-[12.5px] leading-relaxed text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
        <code>{highlight(text, lang)}</code>
      </pre>
    </figure>
  )
}

const CHECKLIST_KEY = 'workrelay.docs.checklist'

function readChecked(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CHECKLIST_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** The go-live list: ticks are kept in this browser, so a developer can come back to it. */
function Checklist({ items }: { items: ListItem[] }) {
  const [checked, setChecked] = useState<string[]>(readChecked)
  const labels = items.map((it) => inlineText(it.inline))
  const done = labels.filter((l) => checked.includes(l)).length
  function toggle(label: string) {
    const next = checked.includes(label) ? checked.filter((x) => x !== label) : [...checked, label]
    setChecked(next)
    try {
      localStorage.setItem(CHECKLIST_KEY, JSON.stringify(next))
    } catch {
      // storage unavailable: it still works for this visit
    }
  }
  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground" role="status">
        <span className="tnum font-medium text-foreground">
          {done} of {items.length}
        </span>{' '}
        done. Your ticks are saved in this browser.
      </p>
      <ul className="divide-y border-y">
        {items.map((it, i) => {
          const on = checked.includes(labels[i])
          return (
            <li key={labels[i]}>
              <label className="flex cursor-pointer items-start gap-3 py-3">
                <input type="checkbox" checked={on} onChange={() => toggle(labels[i])} className="mt-1 size-4 shrink-0 cursor-pointer accent-[var(--primary)]" />
                <span className={cn('max-w-[68ch] leading-relaxed transition-colors', on && 'text-muted-foreground')}>
                  <Inlines nodes={it.inline} />
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Table({ head, rows }: { head: Inline[][]; rows: Inline[][][] }) {
  return (
    <div role="region" aria-label="Table, scrolls sideways on narrow screens" tabIndex={0} className="overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <table className="w-full min-w-[34rem] border-collapse text-left text-[0.9375rem] leading-relaxed">
        <thead>
          <tr className="border-b">
            {head.map((h, i) => (
              <th key={i} scope="col" className="py-2.5 pr-5 text-xs font-medium text-muted-foreground">
                <Inlines nodes={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, ri) => (
            <tr key={ri} className="align-top">
              {r.map((c, ci) => (
                <td key={ci} className="py-3 pr-5">
                  <Inlines nodes={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'heading': {
            if (b.level === 2) {
              return (
                <h2 key={i} id={b.id} data-doc-section className="mt-20 mb-1 scroll-mt-24 font-display text-balance text-[1.75rem] leading-[1.1] font-semibold tracking-[-0.02em] first:mt-0 sm:text-3xl">
                  <Inlines nodes={b.inline} />
                </h2>
              )
            }
            return (
              <h3 key={i} id={b.id} className="mt-10 mb-0 scroll-mt-24 font-display text-balance text-xl leading-snug font-semibold tracking-tight">
                <Inlines nodes={b.inline} />
              </h3>
            )
          }
          case 'para':
            return (
              <p key={i} className="max-w-[72ch] leading-[1.7]">
                <Inlines nodes={b.inline} />
              </p>
            )
          case 'code':
            return (
              <CodeBlock key={i} lang={b.lang} text={b.text} />
            )
          case 'table':
            return <Table key={i} head={b.head} rows={b.rows} />
          case 'list': {
            if (b.items.length > 0 && b.items.every((it) => it.task)) return <Checklist key={i} items={b.items} />
            const Tag = b.ordered ? 'ol' : 'ul'
            return (
              <Tag
                key={i}
                {...(b.ordered && b.start !== 1 ? { start: b.start } : {})}
                className={cn('max-w-[72ch] space-y-2.5 pl-5 leading-[1.7] marker:text-muted-foreground', b.ordered ? 'list-decimal' : 'list-disc')}
              >
                {b.items.map((it, j) => (
                  <li key={j} className="pl-1">
                    <Inlines nodes={it.inline} />
                    {it.blocks.length > 0 && (
                      <div className="mt-3 space-y-3">
                        <Blocks blocks={it.blocks} />
                      </div>
                    )}
                  </li>
                ))}
              </Tag>
            )
          }
        }
      })}
    </>
  )
}

