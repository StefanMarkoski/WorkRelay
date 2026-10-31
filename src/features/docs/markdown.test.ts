import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import guide from '../../../documentation/shop-developer-guide.md?raw'
import { inlineText, parseInline, parseMarkdown, slugify, type Block } from './markdown'
import { Blocks, resolveHref } from './render'

describe('inline text', () => {
  it('reads code, bold, italic and links, and a code span protects what is inside it', () => {
    expect(parseInline('a **b `c**` d** *e* [f](./g.md)')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'strong', c: [{ t: 'text', v: 'b ' }, { t: 'code', v: 'c**' }, { t: 'text', v: ' d' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'e' }] },
      { t: 'text', v: ' ' },
      { t: 'link', href: './g.md', c: [{ t: 'text', v: 'f' }] },
    ])
  })
  it('keeps a lone asterisk and an unmatched backtick as text', () => {
    expect(inlineText(parseInline('2 * 3 and `open'))).toBe('2 * 3 and `open')
  })
})

describe('blocks', () => {
  it('makes slugs from headings, without the section number', () => {
    expect(slugify('3. Start here: the order webhook')).toBe('start-here-the-order-webhook')
    expect(slugify('"A new customer\'s first order" (no extra work)')).toBe('a-new-customer-s-first-order-no-extra-work')
  })

  it('keeps a code block and a second paragraph inside the list item they are indented under', () => {
    const [list] = parseMarkdown('1. First\n\n   ```json\n   {"a": 1}\n   ```\n\n2. Second\n   continues here\n')
    expect(list).toMatchObject({ t: 'list', ordered: true, items: [{ blocks: [{ t: 'code', lang: 'json', text: '{"a": 1}' }] }, { blocks: [] }] })
    expect(inlineText((list as Extract<Block, { t: 'list' }>).items[1].inline)).toBe('Second continues here')
  })

  it('reads a table, and a pipe inside a code span stays in its cell', () => {
    const [table] = parseMarkdown('| A | B |\n|---|---|\n| `x|y` | two |\n')
    expect(table).toMatchObject({ t: 'table' })
    const t = table as Extract<Block, { t: 'table' }>
    expect(t.head.map(inlineText)).toEqual(['A', 'B'])
    expect(t.rows[0].map(inlineText)).toEqual(['x|y', 'two'])
  })

  it('reads task items', () => {
    const [list] = parseMarkdown('- [ ] one\n- [x] two\n')
    expect((list as Extract<Block, { t: 'list' }>).items.map((i) => i.task?.checked)).toEqual([false, true])
  })

  it('does not drop what it does not know: an odd line comes through as text', () => {
    const [p] = parseMarkdown('> a quote, which the guide never uses')
    expect(inlineText((p as Extract<Block, { t: 'para' }>).inline)).toContain('a quote')
  })
})

describe('the developer guide as the site shows it', () => {
  const blocks = parseMarkdown(guide)
  const html = renderToStaticMarkup(createElement(Blocks, { blocks }))

  it('has a title, the eight sections, and the headings the "where to start" list points at', () => {
    expect(blocks.filter((b) => b.t === 'heading' && b.level === 1)).toHaveLength(1)
    const ids = blocks.filter((b) => b.t === 'heading').map((b) => (b as Extract<Block, { t: 'heading' }>).id)
    expect(blocks.filter((b) => b.t === 'heading' && b.level === 2)).toHaveLength(8)
    for (const id of ['start-here-the-order-webhook', 'customers', 'inventory', 'test-it', 'when-something-is-not-showing-up']) expect(ids).toContain(id)
    expect(new Set(ids).size).toBe(ids.length) // anchors are unique
  })

  it('shows every code block, table and checklist item of the source', () => {
    expect((html.match(/<figure/g) ?? []).length).toBe((guide.match(/^\s*```\w*$/gm) ?? []).length / 2)
    expect((html.match(/<table/g) ?? []).length).toBe((guide.match(/^\|[-| :]+\|$/gm) ?? []).length)
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe((guide.match(/^- \[ \]/gm) ?? []).length)
  })

  it('leaves no markdown punctuation behind in the text, and no relative link', () => {
    const text = html.replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<[^>]+>/g, '')
    expect(text).not.toMatch(/\*\*|\]\(|^#+ /m)
    expect(html).not.toMatch(/href="\.\//)
    for (const m of guide.matchAll(/\]\((\.\/[^)]+)\)/g)) expect(resolveHref(m[1]).href).toMatch(/^https:\/\/github\.com\/.+\/documentation\//)
  })

  it('never names another platform', () => {
    expect(html.toLowerCase()).not.toContain('shopify')
  })
})
