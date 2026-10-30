import { useId, useState, type ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { Legend, type LegendItem } from './legend'

export interface TableView {
  columns: string[]
  rows: (string | number)[][]
}

/**
 * The frame every chart sits in: a title, an optional one-line explanation, optional controls, the chart, its legend,
 * and a Chart/Table switch. The table is the same numbers as text, for anyone who cannot or does not want to read marks.
 * `busy` keeps the last picture on screen at reduced strength while new numbers load, so the layout never jumps.
 */
export function ChartCard({
  title,
  description,
  actions,
  controlsBelow = false,
  legend,
  table,
  busy,
  footer,
  className,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  /** Put the controls on their own row under the title, for a card with several of them. */
  controlsBelow?: boolean
  legend?: LegendItem[]
  table?: TableView
  busy?: boolean
  footer?: ReactNode
  className?: string
  children: ReactNode
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const id = useId()
  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1 basis-44">
          <h2 id={id} className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        <div className={cn('flex flex-wrap items-center gap-2', controlsBelow ? 'w-full' : 'ml-auto justify-end')}>
          {actions}
          {table && (
            <Segmented
              className={controlsBelow ? 'ml-auto' : undefined}
              label={`${title}: view`}
              value={view}
              onChange={setView}
              options={[{ id: 'chart', label: 'Chart' }, { id: 'table', label: 'Table' }]}
            />
          )}
        </div>
      </div>
      <div className={cn('flex-1 p-5 transition-opacity duration-150', busy && 'opacity-60')} aria-labelledby={id} aria-busy={busy || undefined}>
        {view === 'table' && table ? (
          <div className="max-h-80 overflow-auto rounded-md border">
            <Table>
              <THead>
                <tr>{table.columns.map((c, i) => <TH key={c} className={i > 0 ? 'text-right' : undefined}>{c}</TH>)}</tr>
              </THead>
              <tbody>
                {table.rows.map((r, ri) => (
                  <TR key={ri}>{r.map((cell, ci) => <TD key={ci} className={ci > 0 ? 'text-right tabular-nums' : 'whitespace-nowrap'}>{cell}</TD>)}</TR>
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          <>
            {children}
            {legend && legend.length > 1 && <div className="mt-4"><Legend items={legend} /></div>}
          </>
        )}
      </div>
      {footer && <div className="border-t px-5 py-3 text-xs text-muted-foreground">{footer}</div>}
    </Card>
  )
}
