/** The product's mark is its own part: a small block of channel lamps with one lit. */
export function BrandMark({ className = 'size-7' }: { className?: string }) {
  return (
    <span aria-hidden className={`grid ${className} shrink-0 grid-cols-2 gap-[3px] rounded-md bg-[var(--housing)] p-[5px]`}>
      <span className="rounded-full bg-[var(--lamp-off)]" />
      <span className="rounded-full bg-[var(--signal)]" />
      <span className="rounded-full bg-[var(--lamp-off)]" />
      <span className="rounded-full bg-[var(--lamp-off)]" />
    </span>
  )
}
