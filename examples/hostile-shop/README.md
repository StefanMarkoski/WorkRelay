# Hostile shop

A mock shop for testing WorkRelay's stock write-back against the things real shops do: answer slowly, serve a cached feed, fail at random, sell
stock on their own, ignore `?skus=`. One file, no dependencies (Node 20+). It is a test tool and a reference for how a shop verifies WorkRelay's
signed requests; it is not meant for production.

```bash
cp state.example.json state.json          # { "SKU": { "name": "...", "stock": 5 } }
WR_SECRET=wr_sign_... STATE_FILE=state.json BEHAVIOUR_FILE=behaviour.json PORT=4800 node shop.mjs
```

It listens on `127.0.0.1`. WorkRelay needs a public https address, so put a tunnel or a proxy in front of it; its stock address is
`https://<public address>/stock` and its product feed address is `https://<public address>/feed`.

`behaviour.json` is read again on every request, so change it while the shop runs. Every key is optional.

| Key | Default | What it does |
|---|---|---|
| `latencyMs` | `[0, 0]` | Answer after a random delay in this range |
| `errorRate` | `0` | Share of requests that fail, as `500`, `429` or a hang (WorkRelay gives up after 10 s) |
| `errorKinds` | `["500","429","hang"]` | Which failures `errorRate` picks from |
| `rateLimitPerMinute` | `null` | Over this many requests a minute, answer `429` with `Retry-After` |
| `feedCacheSeconds` | `0` | The feed is a snapshot up to this old, like a cache in front of the shop |
| `ignoreFilter` | `false` | Answer with the whole feed even when `?skus=` is asked |
| `omitSkus` | `[]` | Products the feed does not list |
| `brokenFeedRate` | `0` | Share of feed answers that are cut off and not valid JSON |
| `ownSalesEverySeconds` | `0` | The shop sells a unit of a random product this often, without WorkRelay hearing of an order |
| `ownSalesMaxQty` | `3` | The most units one own sale takes |
| `applyOnlyIfUnmoved` | `false` | Refuse a number when the shop's stock is no longer the `reported_stock` WorkRelay sent |
| `slowBodyMs` | `0` | Send the first bytes of the feed, then wait before the rest |

It follows the rules of the integration guide: a request is accepted only with a valid signature and a timestamp within 5 minutes, a repeated
request id is ignored, a number whose `seq` is lower than the last applied for that SKU is ignored, a SKU it does not know is ignored but the
request still answers `2xx`.
