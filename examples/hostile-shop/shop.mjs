// A mock shop that behaves like a real one on a bad day, for testing WorkRelay's stock write-back. No dependencies (Node 20+).
//
//   GET  /feed[?skus=A,B]  the product feed WorkRelay reads before and after it sends (honours ?skus= unless told not to)
//   POST /stock            the signed stock.update / stock.test receiver (signature, replay and seq rules as in the integration guide)
//
//   WR_SECRET=wr_sign_...  STATE_FILE=state.json  BEHAVIOUR_FILE=behaviour.json  PORT=4800  node shop.mjs
//
// STATE_FILE is { "SKU": { "name": "...", "stock": 5 } }. BEHAVIOUR_FILE is read again on every request, so a scenario can be changed while
// it runs. Every knob is optional; the defaults are an honest, instant shop. See README.md for the list.
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'

const secret = (process.env.WR_SECRET ?? (process.env.WR_SECRET_FILE ? fs.readFileSync(process.env.WR_SECRET_FILE, 'utf8') : '')).trim()
if (!secret) throw new Error('Set WR_SECRET (or WR_SECRET_FILE): the shop cannot check a signature without it.')
const port = Number(process.env.PORT ?? 4800)
const stateFile = process.env.STATE_FILE ?? 'state.json'
const behaviourFile = process.env.BEHAVIOUR_FILE ?? 'behaviour.json'
const logFile = process.env.LOG_FILE

const DEFAULTS = {
  latencyMs: [0, 0], // answer after a random delay in this range
  errorRate: 0, // share of requests that fail
  errorKinds: ['500', '429', 'hang'], // what a failure looks like; 'hang' never answers (WorkRelay times out after 10 s)
  rateLimitPerMinute: null, // more requests than this in a minute are answered 429 with Retry-After
  feedCacheSeconds: 0, // the feed is a snapshot at most this old (a CDN or a cache in front of the shop)
  ignoreFilter: false, // answer with the whole feed even when ?skus= is given
  omitSkus: [], // products the feed does not list
  brokenFeedRate: 0, // share of feed answers that are not valid JSON
  ownSalesEverySeconds: 0, // the shop sells a unit of a random product this often, without WorkRelay knowing (a till, a marketplace)
  ownSalesMaxQty: 3,
  applyOnlyIfUnmoved: false, // refuse a number when the shop's own stock is no longer the reported_stock WorkRelay sent
  slowBodyMs: 0, // send the headers, then wait this long before the body
}
const behaviour = () => {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(behaviourFile, 'utf8')) } } catch { return DEFAULTS }
}
const out = (line) => { const s = `${new Date().toISOString()} ${line}`; console.log(s); if (logFile) fs.appendFileSync(logFile, s + '\n') }
const load = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'))
const save = (s) => fs.writeFileSync(stateFile, JSON.stringify(s, null, 1))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const between = ([a, b]) => a + Math.random() * Math.max(0, b - a)

let snapshot = null // { at, products }
const seen = new Set() // request ids already applied
const lastSeq = new Map() // sku -> highest seq applied
const recent = [] // request times, for the rate limit

function feedProducts(b) {
  const live = Object.entries(load()).filter(([sku]) => !b.omitSkus.includes(sku)).map(([sku, v]) => ({ sku, name: v.name, stock: v.stock }))
  if (!b.feedCacheSeconds) return live
  if (!snapshot || Date.now() - snapshot.at > b.feedCacheSeconds * 1000) snapshot = { at: Date.now(), products: live }
  return snapshot.products
}

function verify(req, raw) {
  const ts = String(req.headers['x-workrelay-timestamp'] ?? ''), rid = String(req.headers['x-workrelay-request-id'] ?? '')
  const given = Buffer.from(String(req.headers['x-workrelay-signature'] ?? ''))
  const want = Buffer.from('v1=' + crypto.createHmac('sha256', secret).update(`${ts}.${rid}.${raw}`).digest('hex'))
  return !!ts && Math.abs(Date.now() / 1000 - Number(ts)) < 300 && given.length === want.length && crypto.timingSafeEqual(given, want)
}

async function handle(req, res) {
  const b = behaviour()
  const url = new URL(req.url, 'http://x')
  const now = Date.now()
  recent.push(now)
  while (recent.length && recent[0] < now - 60_000) recent.shift()
  if (b.rateLimitPerMinute && recent.length > b.rateLimitPerMinute) {
    out(`${req.method} ${url.pathname} -> 429 (rate limit)`)
    return res.writeHead(429, { 'retry-after': '5' }).end()
  }
  if (b.errorRate && Math.random() < b.errorRate) {
    const kind = b.errorKinds[Math.floor(Math.random() * b.errorKinds.length)]
    out(`${req.method} ${url.pathname} -> ${kind} (injected failure)`)
    if (kind === 'hang') return // never answers
    return res.writeHead(Number(kind)).end()
  }
  await sleep(between(b.latencyMs))

  if (req.method === 'GET') {
    let products = feedProducts(b)
    const want = url.searchParams.get('skus')
    if (want && !b.ignoreFilter) { const set = new Set(want.split(',')); products = products.filter((p) => set.has(p.sku)) }
    out(`FEED ${want ? (b.ignoreFilter ? 'asked for ' + want.split(',').length + ', filter ignored' : 'filtered ' + want.split(',').length) : 'full'} -> ${products.length}${b.feedCacheSeconds && snapshot ? ` (snapshot ${Math.round((Date.now() - snapshot.at) / 1000)}s old)` : ''}`)
    const body = Math.random() < b.brokenFeedRate ? '{"products":[{"sku":' : JSON.stringify({ products })
    res.writeHead(200, { 'content-type': 'application/json' })
    if (b.slowBodyMs) { res.write(body.slice(0, 5)); await sleep(b.slowBodyMs); return res.end(body.slice(5)) }
    return res.end(body)
  }

  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (req.method !== 'POST' || !verify(req, raw)) { out(`REJECTED ${req.method} ${url.pathname} (signature, time or method)`); return res.writeHead(401).end() }
  let body
  try { body = JSON.parse(raw) } catch { return res.writeHead(400).end() }
  const rid = String(req.headers['x-workrelay-request-id'])
  if (body.type === 'stock.test') { out(`TEST ok`); return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ challenge: body.challenge })) }
  if (seen.has(rid)) { out(`REPEAT ${rid} ignored`); return res.writeHead(200).end('{"ok":true}') }
  seen.add(rid)
  const st = load()
  out(`${body.type} ${rid.slice(0, 8)} items=${body.items?.length}`)
  for (const i of body.items ?? []) {
    const cur = st[i.sku]
    if (!cur) { out(`   ${i.sku}: unknown here, ignored`); continue }
    if (i.seq <= (lastSeq.get(i.sku) ?? -1)) { out(`   ${i.sku}: seq ${i.seq} is older than the last applied, ignored`); continue }
    if (b.applyOnlyIfUnmoved && i.reported_stock != null && cur.stock !== i.reported_stock) {
      out(`   ${i.sku}: shop has ${cur.stock}, WorkRelay read ${i.reported_stock}: the shop moved on its own, number refused`)
      continue
    }
    lastSeq.set(i.sku, i.seq)
    out(`   ${i.sku}: ${cur.stock} -> ${i.stock}`)
    cur.stock = i.stock
  }
  save(st)
  res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
}

http.createServer((req, res) => { handle(req, res).catch((e) => { out(`error ${e.message}`); if (!res.headersSent) res.writeHead(500).end() }) })
  .listen(port, '127.0.0.1', () => out(`hostile shop on ${port}`))

// The shop's own sales: stock moves without WorkRelay hearing about an order.
let lastSale = Date.now()
setInterval(() => {
  const b = behaviour()
  if (!b.ownSalesEverySeconds || Date.now() - lastSale < b.ownSalesEverySeconds * 1000) return
  lastSale = Date.now()
  const st = load(), skus = Object.keys(st).filter((k) => st[k].stock > 0)
  if (!skus.length) return
  const sku = skus[Math.floor(Math.random() * skus.length)]
  const qty = Math.min(st[sku].stock, 1 + Math.floor(Math.random() * b.ownSalesMaxQty))
  st[sku].stock -= qty
  save(st)
  out(`OWN SALE ${sku} -${qty} -> ${st[sku].stock}`)
}, 500)
