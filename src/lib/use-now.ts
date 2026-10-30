import { useEffect, useState } from 'react'

/** The current time, refreshed on an interval, so things that depend on it ("renews in…", "ago") stay true without a refetch. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
