# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Primary: the shop owner or operator of an e-commerce store, checking the dashboard day to day to see orders, stock and customers move and be sure nothing is slipping. Plain members of a workspace see less than admins (Automations is admin-only). A platform superadmin creates tenants and their owner logins.

## Product Purpose
WorkRelay is one core block for running an online shop's day-to-day: orders, inventory and stock, customers, and the trends behind them. A shop sends its events (orders, customer signups, stock updates) to WorkRelay, or WorkRelay fetches its products on a schedule. WorkRelay keeps each order organised with a timeline, tracks stock against alert levels, builds one customer profile per person across shops, charts trends in Insights, shows a live feed, and runs simple follow-up automations (Discord, Slack or webhook messages for a new order, a low-stock product, a signup, a first order or a product sync; review of large orders) with an approvals queue. Shipping and fulfilment, adding products and native shop-platform connectors are the next pieces, all running on many different shops.

## Positioning
Works with any custom shop. A shop owner does not build the shop on WorkRelay's system. WorkRelay plugs into whatever shop they already have, the way a payment system does, and adds many more shop-management features on top. If a shop can send a webhook, it connects; no plugin or platform lock-in.

## Operating Context
Multi-tenant: each workspace is bound to one or more store ids with per-store secret keys (`wr_live_...`, hashed). Orders, customer signups and stock updates arrive through key-authenticated webhooks (idempotent and safe against out-of-order delivery), products can also be pulled from the shop on a schedule, and the dashboard updates in realtime. Each shop has one currency, and the shop is the source of truth for stock. Developers connect a shop using `documentation/shop-webhook-integration.md`. The app is a static Vite/React site (hash routing, GitHub Pages) on a hosted Supabase backend, with dark and light themes.

## Capabilities and Constraints
- Built: landing page, auth, superadmin Tenants console, per-tenant keys, order ingestion, orders list and detail with timeline, customers per shop (including signups), inventory (products and stock reported by the shop, push and scheduled pull, Sync now, alert levels and low-stock alerts), Insights charts, Live feed, preset Automations on a queue engine with retries and approvals (new order, status change, signup, first order, low stock, product sync; duplicates refused, soft delete), executions history, integrations page with payload tester and event history, realtime dashboard, settings.
- Planned and committed in direction (not built): shipping and fulfilment, native shop-platform connectors with write-back, adding new products, and broadly anything else an e-commerce shop needs managed.
- Not built yet: email actions, invitation emails, signed webhook requests, CSV export, notifications and global search.
- Terminology: "Automations" (not workflows), "Executions", "Approvals", "Integrations".
- Undecided: whether sign-up on the login screen stays open or becomes log-in only.

## Brand Commitments
The product name is WorkRelay. The owner has kept a violet brand colour so far and has said they are open to changing it; they offered black with green as a suggestion, not a requirement, and prefer a matte, professional feel. Treat those as open ideas, not binding constraints.

## Evidence on Hand
A friend's real demo shop (two stores) is already sending live orders, signups and stock updates, and the Discord automations have run. There are no customer testimonials, case studies, press or benchmarks; future work must not invent customers, quotes, order counts or performance claims. The landing page and dashboard must use real data or clearly mock data, never invented statistics.

## Product Principles
- Stay platform-neutral: the shop owner never has to rebuild their shop to use WorkRelay.
- Be infrastructure the owner can trust: calm, accurate and complete beats flashy.
- Keep features simple and easy to explain (presets over a workflow builder).
- Build a core block, not a one-off: each new capability (shipping, fulfilment, new connectors) should slot in beside orders, stock and customers.
