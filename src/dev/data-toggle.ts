import { DATA_MODES, type DataMode } from './mock-datasets'

/**
 * A small dev-only switch fixed at the bottom of the screen. It is plain chrome, not part of the design under test.
 * The choice lives in the URL (?data=...), so a reload or a shared link keeps it. Only the mock-data build imports this.
 */
export function mountDataToggle(current: DataMode) {
  if (typeof document === 'undefined') return
  const mount = () => {
    if (document.getElementById('dev-data-toggle')) return
    const bar = document.createElement('div')
    bar.id = 'dev-data-toggle'
    bar.setAttribute('role', 'group')
    bar.setAttribute('aria-label', 'Dev data set')
    bar.style.cssText =
      'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:2147483000;display:flex;gap:2px;padding:3px;border-radius:9px;background:#d4d4d8;font:12px/1 system-ui,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.35)'
    for (const m of DATA_MODES) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = m.label
      b.setAttribute('aria-pressed', String(m.id === current))
      b.style.cssText = `border:0;cursor:pointer;padding:6px 10px;border-radius:7px;color:#18181b;background:${m.id === current ? '#fff' : 'transparent'};font:inherit;white-space:nowrap`
      b.addEventListener('click', () => {
        const url = new URL(window.location.href)
        if (m.id === 'demo') url.searchParams.delete('data')
        else url.searchParams.set('data', m.id)
        window.location.href = url.toString()
      })
      bar.appendChild(b)
    }
    document.body.appendChild(bar)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
  else mount()
}
