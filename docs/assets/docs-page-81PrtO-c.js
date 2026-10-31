import{a as e,c as t,d as n,i as r,l as i,n as a,o,s,t as c,u as l}from"./index-CoGH8Ygx.js";var u=n(l(),1);function d(e){return e.replace(/^\d+\.\s+/,``).toLowerCase().replace(/[^a-z0-9]+/g,`-`).replace(/^-+|-+$/g,``)}function f(e){let t=[],n=``,r=()=>{n&&t.push({t:`text`,v:n}),n=``},i=0;for(;i<e.length;){let a=e[i];if(a==="`"){let n=e.indexOf("`",i+1);if(n>i){r(),t.push({t:`code`,v:e.slice(i+1,n)}),i=n+1;continue}}if(a===`*`&&e[i+1]===`*`){let n=p(e,i+2,`**`);if(n>i+2){r(),t.push({t:`strong`,c:f(e.slice(i+2,n))}),i=n+2;continue}}if(a===`*`&&e[i+1]!==`*`&&e[i+1]!==` `){let n=p(e,i+1,`*`);if(n>i+1){r(),t.push({t:`em`,c:f(e.slice(i+1,n))}),i=n+1;continue}}if(a===`[`){let n=/^\[((?:[^\]`]|`[^`]*`)+)\]\(([^)\s]+)\)/.exec(e.slice(i));if(n){r(),t.push({t:`link`,href:n[2],c:f(n[1])}),i+=n[0].length;continue}}n+=a,i+=1}return r(),t}function p(e,t,n){let r=t;for(;r<e.length;)if(e[r]==="`"){let t=e.indexOf("`",r+1);if(t<0)return-1;r=t+1}else{if(e.startsWith(n,r)){if(n===`*`&&e[r+1]===`*`){r+=2;continue}return r}r+=1}return-1}var m=/^(\s*)```(\w*)\s*$/,h=/^(#{1,6})\s+(.*?)\s*$/,g=/^(\s*)([-*]|\d+\.)\s+(.*)$/,_=/^\s*\|?[\s:|-]+\|[\s:|-]*$/,v=e=>e.length-e.trimStart().length;function y(e){let t=e.trim().replace(/^\|/,``).replace(/\|$/,``),n=[],r=``,i=!1;for(let e=0;e<t.length;e++){let a=t[e];a==="`"&&(i=!i),a===`|`&&!i&&t[e-1]!==`\\`?(n.push(r.trim()),r=``):r+=a}return n.push(r.trim()),n}function b(e){let t=[],n=0;for(;n<e.length;){let r=e[n];if(r.trim()===``){n+=1;continue}let i=m.exec(r);if(i){let r=[];for(n+=1;n<e.length&&!m.test(e[n]);)r.push(e[n].startsWith(i[1])?e[n].slice(i[1].length):e[n]),n+=1;n+=1,t.push({t:`code`,lang:i[2],text:r.join(`
`)});continue}let a=h.exec(r);if(a){let e=a[2].replace(/`/g,``);t.push({t:`heading`,level:a[1].length,id:d(e),text:e,inline:f(a[2])}),n+=1;continue}if(r.trimStart().startsWith(`|`)&&n+1<e.length&&_.test(e[n+1])){let i=y(r).map(f);n+=2;let a=[];for(;n<e.length&&e[n].trimStart().startsWith(`|`);)a.push(y(e[n]).map(f)),n+=1;t.push({t:`table`,head:i,rows:a});continue}let o=g.exec(r);if(o){let r=o[1].length,i=/\d/.test(o[2]),a=i?parseInt(o[2],10):1,s=[];for(;n<e.length;){let t=g.exec(e[n]);if(!t||t[1].length!==r||/\d/.test(t[2])!==i)break;let a=t[1].length+t[2].length+1,o=[t[3]];for(n+=1;n<e.length;){let t=e[n];if(t.trim()===``){let t=n;for(;t<e.length&&e[t].trim()===``;)t+=1;if(t<e.length&&v(e[t])>r){o.push(``),n+=1;continue}break}if(v(t)>r)o.push(t.slice(Math.min(a,v(t)))),n+=1;else break}let[c,...l]=o,u=/^\[( |x|X)\]\s+/.exec(c),d=u?c.slice(u[0].length):c,p=0;for(;p<l.length&&l[p].trim()!==``&&!m.test(l[p])&&!g.test(l[p]);)p+=1;let h=[d,...l.slice(0,p)].join(` `);s.push({task:u?{checked:u[1]!==` `}:void 0,inline:f(h),blocks:b(l.slice(p))});let _=n;for(;_<e.length&&e[_].trim()===``;)_+=1;let y=_<e.length?g.exec(e[_]):null;y&&y[1].length===r&&/\d/.test(y[2])===i&&(n=_)}t.push({t:`list`,ordered:i,start:a,items:s});continue}let s=[r.trim()];for(n+=1;n<e.length&&e[n].trim()!==``&&!m.test(e[n])&&!h.test(e[n])&&!g.test(e[n])&&!e[n].trimStart().startsWith(`|`);)s.push(e[n].trim()),n+=1;t.push({t:`para`,inline:f(s.join(` `))})}return t}function x(e){return b(e.replace(/\r\n/g,`
`).split(`
`))}function S(e){return e.map(e=>e.t===`text`||e.t===`code`?e.v:S(e.c)).join(``)}var C=i(),w=`text-white/60`,T=`text-[oklch(0.82_0.1_150)]`,E=`text-white/45`;function D(e){let t=[],n=/("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?)|\b(true|false|null)\b/g,r=0;for(let i=n.exec(e);i;i=n.exec(e))i.index>r&&t.push(e.slice(r,i.index)),i[1]===void 0?t.push((0,C.jsx)(`span`,{children:i[0]},i.index)):(t.push((0,C.jsx)(`span`,{className:i[2]?w:T,children:i[1]},i.index)),i[2]&&t.push(i[2])),r=i.index+i[0].length;return r<e.length&&t.push(e.slice(r)),t}function O(e){if(e.trimStart().startsWith(`#`))return[(0,C.jsx)(`span`,{className:E,children:e},`c`)];let t=[],n=/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g,r=0;for(let i=n.exec(e);i;i=n.exec(e))i.index>r&&t.push(e.slice(r,i.index)),t.push((0,C.jsx)(`span`,{className:T,children:i[0]},i.index)),r=i.index+i[0].length;return r<e.length&&t.push(e.slice(r)),t}function k(e){let t=/^(GET|POST|PUT|DELETE)(\s.*)$/.exec(e);if(t)return[(0,C.jsx)(`span`,{className:T,children:t[1]},`m`),t[2]];let n=/^([A-Za-z-]+:)(\s.*)$/.exec(e);return n?[(0,C.jsx)(`span`,{className:w,children:n[1]},`h`),n[2]]:D(e)}function A(e,t){let n=t===`json`?D:t===`bash`||t===`sh`?O:k;return e.split(`
`).map((e,t,r)=>(0,C.jsxs)(`span`,{children:[n(e),t<r.length-1?`
`:``]},t))}var j=`https://github.com/StefanMarkoski/WorkRelay/blob/main/documentation/`;function M(e){return e.startsWith(`./`)?{href:j+e.slice(2),external:!0}:{href:e,external:/^https?:/.test(e)}}function N({nodes:e}){return(0,C.jsx)(C.Fragment,{children:e.map((e,t)=>{switch(e.t){case`text`:return(0,C.jsx)(u.Fragment,{children:e.v},t);case`code`:return(0,C.jsx)(`code`,{className:`rounded bg-muted px-1.5 py-0.5 font-mono text-[0.86em] break-words text-foreground`,children:e.v},t);case`strong`:return(0,C.jsx)(`strong`,{className:`font-semibold text-foreground`,children:(0,C.jsx)(N,{nodes:e.c})},t);case`em`:return(0,C.jsx)(`em`,{children:(0,C.jsx)(N,{nodes:e.c})},t);case`link`:{let{href:n,external:r}=M(e.href);return(0,C.jsx)(`a`,{href:n,...r?{target:`_blank`,rel:`noopener noreferrer`}:{},className:`font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring`,children:(0,C.jsx)(N,{nodes:e.c})},t)}}})})}var P={json:`JSON`,bash:`SHELL`,sh:`SHELL`,"":`HTTP`};function F({text:t,label:n,className:r}){let[i,a]=(0,u.useState)(!1);async function c(){try{await navigator.clipboard.writeText(t),a(!0),window.setTimeout(()=>a(!1),1600)}catch{}}return(0,C.jsxs)(`button`,{type:`button`,onClick:c,"aria-label":n,className:e(`inline-flex h-8 items-center gap-1.5 rounded-md px-2 font-mono text-[11px] tracking-wide text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]`,r),children:[i?(0,C.jsx)(s,{className:`size-3.5`,"aria-hidden":!0}):(0,C.jsx)(o,{className:`size-3.5`,"aria-hidden":!0}),i?`COPIED`:`COPY`,(0,C.jsx)(`span`,{className:`sr-only`,role:`status`,children:i?`Copied to the clipboard`:``})]})}function I({lang:e,text:t}){return(0,C.jsxs)(`figure`,{className:`housing my-0 overflow-hidden`,children:[(0,C.jsxs)(`figcaption`,{className:`flex items-center justify-between pr-2 pl-4 font-mono text-[11px] tracking-wide text-muted-foreground`,children:[(0,C.jsx)(`span`,{"aria-hidden":!0,children:P[e]??e.toUpperCase()}),(0,C.jsx)(F,{text:t,label:`Copy this ${P[e]??e} example`})]}),(0,C.jsx)(`pre`,{tabIndex:0,className:`overflow-x-auto px-4 pt-1 pb-4 font-mono text-[12.5px] leading-relaxed text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`,children:(0,C.jsx)(`code`,{children:A(t,e)})})]})}var L=`workrelay.docs.checklist`;function R(){try{let e=JSON.parse(localStorage.getItem(L)??`[]`);return Array.isArray(e)?e.filter(e=>typeof e==`string`):[]}catch{return[]}}function z({items:t}){let[n,r]=(0,u.useState)(R),i=t.map(e=>S(e.inline)),a=i.filter(e=>n.includes(e)).length;function o(e){let t=n.includes(e)?n.filter(t=>t!==e):[...n,e];r(t);try{localStorage.setItem(L,JSON.stringify(t))}catch{}}return(0,C.jsxs)(`div`,{children:[(0,C.jsxs)(`p`,{className:`mb-3 text-sm text-muted-foreground`,role:`status`,children:[(0,C.jsxs)(`span`,{className:`tnum font-medium text-foreground`,children:[a,` of `,t.length]}),` `,`done. Your ticks are saved in this browser.`]}),(0,C.jsx)(`ul`,{className:`divide-y border-y`,children:t.map((t,r)=>{let a=n.includes(i[r]);return(0,C.jsx)(`li`,{children:(0,C.jsxs)(`label`,{className:`flex cursor-pointer items-start gap-3 py-3`,children:[(0,C.jsx)(`input`,{type:`checkbox`,checked:a,onChange:()=>o(i[r]),className:`mt-1 size-4 shrink-0 cursor-pointer accent-[var(--primary)]`}),(0,C.jsx)(`span`,{className:e(`max-w-[68ch] leading-relaxed transition-colors`,a&&`text-muted-foreground`),children:(0,C.jsx)(N,{nodes:t.inline})})]})},i[r])})})]})}function B({head:e,rows:t}){return(0,C.jsx)(`div`,{role:`region`,"aria-label":`Table, scrolls sideways on narrow screens`,tabIndex:0,className:`overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-ring`,children:(0,C.jsxs)(`table`,{className:`w-full min-w-[34rem] border-collapse text-left text-[0.9375rem] leading-relaxed`,children:[(0,C.jsx)(`thead`,{children:(0,C.jsx)(`tr`,{className:`border-b`,children:e.map((e,t)=>(0,C.jsx)(`th`,{scope:`col`,className:`py-2.5 pr-5 text-xs font-medium text-muted-foreground`,children:(0,C.jsx)(N,{nodes:e})},t))})}),(0,C.jsx)(`tbody`,{className:`divide-y`,children:t.map((e,t)=>(0,C.jsx)(`tr`,{className:`align-top`,children:e.map((e,t)=>(0,C.jsx)(`td`,{className:`py-3 pr-5`,children:(0,C.jsx)(N,{nodes:e})},t))},t))})]})})}function V({blocks:t}){return(0,C.jsx)(C.Fragment,{children:t.map((t,n)=>{switch(t.t){case`heading`:return t.level===2?(0,C.jsx)(`h2`,{id:t.id,"data-doc-section":!0,className:`mt-20 mb-1 scroll-mt-24 font-display text-balance text-[1.75rem] leading-[1.1] font-semibold tracking-[-0.02em] first:mt-0 sm:text-3xl`,children:(0,C.jsx)(N,{nodes:t.inline})},n):(0,C.jsx)(`h3`,{id:t.id,className:`mt-10 mb-0 scroll-mt-24 font-display text-balance text-xl leading-snug font-semibold tracking-tight`,children:(0,C.jsx)(N,{nodes:t.inline})},n);case`para`:return(0,C.jsx)(`p`,{className:`max-w-[72ch] leading-[1.7]`,children:(0,C.jsx)(N,{nodes:t.inline})},n);case`code`:return(0,C.jsx)(I,{lang:t.lang,text:t.text},n);case`table`:return(0,C.jsx)(B,{head:t.head,rows:t.rows},n);case`list`:{if(t.items.length>0&&t.items.every(e=>e.task))return(0,C.jsx)(z,{items:t.items},n);let r=t.ordered?`ol`:`ul`;return(0,C.jsx)(r,{...t.ordered&&t.start!==1?{start:t.start}:{},className:e(`max-w-[72ch] space-y-2.5 pl-5 leading-[1.7] marker:text-muted-foreground`,t.ordered?`list-decimal`:`list-disc`),children:t.items.map((e,t)=>(0,C.jsxs)(`li`,{className:`pl-1`,children:[(0,C.jsx)(N,{nodes:e.inline}),e.blocks.length>0&&(0,C.jsx)(`div`,{className:`mt-3 space-y-3`,children:(0,C.jsx)(V,{blocks:e.blocks})})]},t))},n)}}})})}var H=x(`# Connecting your shop to WorkRelay: the developer's guide

This is the practical guide for the developer of a shop that connects to WorkRelay. It says **what to build**, **what WorkRelay does with
it**, and **what the WorkRelay team switches on** on their side. For every field, status code and limit, the reference is
[\`shop-webhook-integration.md\`](./shop-webhook-integration.md); this guide links to it instead of repeating it.

- Base URL: \`https://wayktzmupzrdcwosgnfg.supabase.co/functions/v1\`
- You never log in to WorkRelay. You get a **secret key** and a **store id**, and everything else is HTTP.

## 1. What you build

| # | What | Direction | Required? | What it gives the shop's team |
|---|---|---|---|---|
| 1 | **Order webhook** | your shop → WorkRelay | **Yes** | Orders, a timeline per order, **customers**, and notifications for new orders and for a new customer's first order |
| 2 | **Customer signup webhook** | your shop → WorkRelay | Optional | A notification for **every new signup**, and people who registered but have not ordered yet |
| 3 | **Products endpoint** (we call it) | WorkRelay → your shop | Optional | Inventory kept up to date on a schedule, and low-stock alerts |
| 4 | **Inventory webhook** (a "Sync to WorkRelay" button) | your shop → WorkRelay | Optional | The same inventory, **immediately**, when someone presses the button |

Numbers 3 and 4 use the same product format and work together: the schedule keeps stock fresh by itself, and the button is the quick way
to refresh it on demand. You can build either one or both.

## 2. Who does what

Some switches live with the WorkRelay team, not in your code. Ask them for the ones marked **WorkRelay**.

| Setting | Who | Where |
|---|---|---|
| Create the connection, get the **secret key** (shown once) | Shop owner or admin, in WorkRelay | Integrations → Connect store |
| The shop's **currency** (one per shop) | Shop owner or admin; WorkRelay can also set it | Choose it when connecting; change it in Integrations → Edit |
| **Bind** the key to your store id (once) | **You**, from code | \`POST /bind\` |
| Receive customer signups (on/off per shop) | Shop owner or admin | Integrations → Edit → *Receive customer signups* |
| Notifications ("a customer signs up", "a new order arrives", "a shop syncs its products"…) | Shop owner or admin | Automations |
| **Schedule** for calls to your products endpoint (calls per days) | **WorkRelay** | Platform admin |
| Your products **URL** and its **token** | Shop owner or admin | API Calls → Inventory |

## 3. Start here: the order webhook

Everything else builds on orders, so do this first. Section 1 to 8 of the [reference](./shop-webhook-integration.md) describe it fully; the short
version:

1. **Bind once.** \`POST /bind\` with the key and your store id. From then on the key works for that store only.
2. **Send an event for every order change.** \`POST /order-webhook\` with \`Authorization: Bearer <key>\` and \`X-Store-Id: <store id>\`:
   \`order.created\` once, then \`order.updated\` or \`order.status_changed\` for each later change.
3. **Make events safe to retry.** Give each event a stable, unique \`event_id\`. Repeats are answered \`duplicate\`; older data never overwrites newer.

What matters most for the rest of this guide, so please include it **on every order**:

| Field | Why it matters |
|---|---|
| \`order.customer.email\` | **This is what makes a customer.** An order without an email address is stored, but no customer is created for it |
| \`order.customer.name\`, \`.phone\` | Shown on the customer |
| \`order.items[].sku\` and \`.name\` | Every item with a \`sku\` becomes a product in Inventory, and drives best-seller and sales numbers |
| \`order.currency\` | Optional: if you leave it out, the order takes the shop's currency (see section 6) |

\`\`\`json
{
  "event_id": "ord_1001:created",
  "event_type": "order.created",
  "occurred_at": "2026-10-27T10:00:00Z",
  "order": {
    "external_id": "1001",
    "order_number": "#1001",
    "customer": { "name": "Ana Petrova", "email": "ana@example.com", "phone": "+38970123456" },
    "totals": { "total_minor": 4999 },
    "items": [{ "sku": "TEE-BLK-M", "name": "Black tee (M)", "quantity": 1, "unit_price_minor": 4500 }]
  }
}
\`\`\`

**Times.** \`occurred_at\` is when the event is sent: within the last 7 days and no more than a day ahead, otherwise \`400\`. That leaves room to re-send after an outage. The real date of an older order goes in \`placed_at\` (any time from 2000-01-01), so importing history works. The dates in these examples are samples, so use the current time.

## 4. Customers

### How a customer is made

- **A customer is one person, identified by email address** (capital letters do not matter; spaces around it are not accepted, so send it trimmed). It is the only identity:
  your own customer id can be sent, but is stored for reference and never used to match people.
- **One customer across all of the workspace's shops.** The same email at two shops is one customer.
- WorkRelay creates a customer from **orders** by itself. You do not have to send anything extra for people to appear.

### Who appears where

| The person | Customers page |
|---|---|
| Has **at least one order** with an email address | Listed under **Placed an order** (the default view). A later cancellation does not remove them; cancelled orders are only left out of their order value |
| Ordered with **no email** on the order | Never a customer. The order is still under Orders |
| **Signed up but has not ordered** (you send signups) | Listed only under **Registered only** or **All**. These views appear once at least one shop sends signups |
| Ordered at two shops | One row in **All shops**, with order counts and value added up per currency. Pick a shop and you see only that shop's orders and value for them |

The **shop selector** on the Customers page limits the page to one shop: the people who ordered from it or signed up through it, with that
shop's own numbers.

### "A new customer's first order" (no extra work)

In Automations this is called **a new customer places their first order**. It needs only orders, so every shop has it. It fires **once per customer**, on their first order:

- An automation set to **all shops** fires on the customer's first order **anywhere in the workspace**.
- An automation limited to **chosen shops** fires for each ticked shop the first time that customer orders **from that shop**, even if they ordered
  at another shop before.

### "Every new signup" (what you need to do)

If the team wants a notification for **every new account**, the shop has to tell WorkRelay when one is created.

**You (the shop's developer):**

1. When an account is created, send \`POST /customer-webhook\` with the **same key and \`X-Store-Id\` as orders** (there is no second bind):

   \`\`\`json
   {
     "event_id": "cust_77:created",
     "event_type": "customer.created",
     "occurred_at": "2026-10-27T09:15:00Z",
     "customer": {
       "email": "ana@example.com",
       "name": "Ana Petrova",
       "phone": "+38970123456",
       "external_id": "cust_77",
       "registered_at": "2026-10-27T09:14:52Z"
     }
   }
   \`\`\`

2. Send it **at the moment of registration**, from a background job so a slow response never blocks sign-up. Retry network errors and 5xx with the same \`event_id\`.
3. Optionally send \`customer.updated\` (same shape) when a profile changes. It updates the person but never notifies.
4. To bring in **existing** accounts, send \`customer.created\` for each with their real \`registered_at\`. Anything that happened before signups were switched on is
   saved but **never notifies**, so an import does not flood the team.

**The shop owner (in WorkRelay):**

1. Integrations → **Edit** on the shop → turn on *Receive customer signups*. It is **off by default and per shop**. While it is off, events are kept and shown as
   ignored (HTTP 202); resend them after switching it on.
2. Automations → add one for **a customer signs up**, choose Discord, Slack or a webhook URL, and tick the shop(s) it should cover.

How notifications behave:

- **Once per customer and shop.** A retry, a repeat, or a second \`customer.created\` for the same person at the same shop never notifies twice.
- A signup through **another shop** notifies again (once for each shop), as long as an automation covers that shop.
- **Only \`customer.created\` notifies.** \`customer.updated\` does not.
- The notification is sent within seconds.

Not sure whether a shop sends signups? Customers shows a banner when you pick a shop that does, and the Customers views *Registered only* and *All* only appear
once one shop does.

## 5. Inventory

WorkRelay shows each product's stock and can alert the team when it runs low. **The shop is the source of truth**: WorkRelay shows what you report and never
subtracts stock on its own when an order arrives.

### The product format (the same for push and pull)

\`\`\`json
{
  "products": [
    {
      "sku": "BIKE-ROAD-700",
      "name": "Road bike 700c",
      "stock": 12,
      "notify_on": 5,
      "price_minor": 89900,
      "currency": "EUR",
      "unit": "pcs",
      "category": "Bikes",
      "barcode": "3850123456789",
      "updated_at": "2026-10-30T09:15:00Z"
    },
    { "sku": "NAIL-100", "stock": 4800, "notify_on": 5000 }
  ]
}
\`\`\`

- Only **\`sku\`** is required. Anything absent or \`null\` leaves the stored value as it is, so \`{"sku":"NAIL-100","stock":4800}\` is a complete, valid update.
- **Send the real stock, not a change.** \`stock: 11\` means "there are 11 now". It is safe to repeat and cannot drift. Never send "minus 1".
- **\`notify_on\`** is the shop's own low-stock number: the team is alerted when stock is **at or below** it (bikes at 5, nails at 5,000). The team can also override it per product
  in WorkRelay, and the override wins.
- **\`updated_at\`** (ISO 8601) is when the product last changed in your shop. A report older than what WorkRelay already holds never overwrites it, so a late retry cannot undo a newer update.
- Products are never deleted by a report; a product you stop sending simply keeps its last numbers.
- **Price:** if you send none, WorkRelay shows the latest price from an order line. Prices need a \`currency\`.

Products also appear on their own once an order contains an item with a \`sku\`; their stock then shows as "Not reported" until you report it.

### A. The products endpoint WorkRelay calls (scheduled)

Expose **one read-only \`GET\` endpoint** that returns the product format above. WorkRelay calls it on a schedule the WorkRelay team sets for the shop
(for example 15 calls a day, about every 1 hour 36 minutes).

\`\`\`
GET https://yourshop.com/workrelay/products
Accept: application/json
Authorization: <the value the shop owner entered in WorkRelay>
\`\`\`

What to build:

| Requirement | Detail |
|---|---|
| Method and URL | \`GET\`, **https**, a public address. The shop owner enters the URL in API Calls → Inventory |
| Authentication | Create a **dedicated read-only token** just for this. The shop owner enters it in WorkRelay, and it is sent as the \`Authorization\` header exactly as entered (for example \`Bearer abc123\`). It is stored privately and never shown again. **Do not reuse the WorkRelay secret key**: that one lets anyone write stock into your workspace, this one only lets WorkRelay read your catalogue. Compare it in constant time, and refuse everything else with \`401\` |
| Response | Any \`2xx\` with JSON: either \`{"products":[...]}\` or just the list \`[...]\` |
| Content | The full catalogue, or at least every product whose stock should stay current. Products you leave out are untouched, never deleted |
| Limits | **5,000 products and 5 MB** per answer, and it must answer within **15 seconds**. Larger catalogues are not supported yet |
| Redirects and addresses | Redirects are **not followed** (give the final URL), and the address must resolve to a **public** IP. Private networks, \`localhost\` and plain \`http\` are refused |
| Pagination | None: one request returns everything |
| Cost | Keep it cheap: read from a cache or a single query. A schedule can mean many calls a day |

If a call fails (not 2xx, not JSON, wrong shape, timeout), nothing from it is applied and the reason appears as **"The last check failed"** in API Calls → Inventory and in
Integrations → Event history. A failed call still counts toward the schedule.

The shop owner (or the team) can also press **Sync now** on the Inventory page to run a check immediately. It only works where WorkRelay has set a schedule for the shop, the
URL is entered, and the shop is not paused; each press uses one of the shop's scheduled calls, so it can never exceed the agreed number.

### B. The "Sync to WorkRelay" button (your shop pushes)

For an instant update, add a button to **your own admin** that sends the catalogue to WorkRelay.

\`\`\`
POST https://wayktzmupzrdcwosgnfg.supabase.co/functions/v1/inventory-webhook
Authorization: Bearer <the secret key>
X-Store-Id: <your store id>
Content-Type: application/json

{"products":[{"sku":"BIKE-ROAD-700","stock":11}],"synced_by":{"name":"Marko","role":"Admin"}}
\`\`\`

- Up to **500 products and 1 MB per request**. For a bigger catalogue, send it in chunks of 500, one after the other.
- Run it **in the background** and show progress ("sent 1,500 of 4,200"), so the button never hangs the admin page.
- On a network error or \`5xx\`, retry with the same body (it is safe to repeat). On \`400\`, read \`detail\`, which names the field to fix. Do not retry a \`400\` unchanged.
- **Nothing to switch on.** Any connected shop can push, at any time and as often as it likes. There is no limit on pushes: the "calls per days" WorkRelay sets only limit WorkRelay's own calls to your products endpoint.
- **Say who pressed it.** Put the signed-in admin in \`synced_by\` (\`name\` and \`role\`, both optional). If the team has an automation for **a shop syncs its products**, it announces
  *"Marko (Admin) has synced their products (Game Store)"* in Discord, Slack or a webhook. A sync sent as several chunks is announced **once** (same shop, same person, each request within 90 seconds of the previous one); pressing the button again after a pause is announced again.
  Without \`synced_by\`, the message names the shop instead.
- **Where it shows.** Every applied push updates the shop's "Synced 12m ago, sent by Marko (Admin)" line on the Inventory page, and a push also appears in the Live feed on the Overview.
- **WorkRelay decides who is notified, not the request.** There is nothing in the push to turn the notification on or off. The team controls it in WorkRelay: the automation can be switched
  off, or limited to some shops. If your shop also pushes automatically on a timer or after each sale, tell the team, so they can leave that shop out of the automation or have WorkRelay switch it off.
  Scheduled calls from WorkRelay and its **Sync now** button never announce.
- Each push (and each scheduled call) appears in Integrations → Event history as \`inventory.push\` or \`inventory.pull\`, with a short summary, for 30 days.
- Every sync, pushed by the shop or asked for by WorkRelay, also appears in **Inventory → Sync history**: when, which shop, who started it (your \`synced_by\`), how many products, which ones changed (stock before and after), and the reason when it failed. Kept for 30 days.

Besides the button, you can also push whenever a product's stock changes (after a sale, a restock or an admin edit). Batch changes for a few seconds so a busy shop sends one request, not one per order.

### Which should you build?

- **Smallest useful setup:** the products endpoint (A). WorkRelay does the rest on its schedule.
- **Recommended:** A plus the button (B): fresh stock on a schedule, and instant when someone needs it.
- **Cannot expose a public endpoint** (for example the shop sits behind a firewall): do B only, and add a scheduled job on your side that pushes every 10 to 15 minutes.

## 6. Currency

Each shop has **one currency**, set in WorkRelay, and WorkRelay **never converts** between currencies.

- An order sent **without** a \`currency\` takes the shop's.
- An order sent **with the shop's currency** is used as it is.
- An order sent with a **different** currency is kept exactly as sent and marked as a currency mismatch on the order, so a wrongly configured shop is easy to spot. Correct the payload (or ask for the shop's currency to be corrected) and resend.

## 7. Test it

Replace the key, store id and URLs with your own.

\`\`\`bash
BASE=https://wayktzmupzrdcwosgnfg.supabase.co/functions/v1
KEY=wr_live_...
STORE=your-store-id

# 1. Bind once
curl -s -X POST "$BASE/bind" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d "{\\"store_id\\":\\"$STORE\\"}"

# Events must be recent (within the last 7 days), so the examples below stamp themselves with the current time
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 2. An order with a customer: expect {"status":"processed"}, then the person appears under Customers
curl -s -X POST "$BASE/order-webhook" -H "Authorization: Bearer $KEY" -H "X-Store-Id: $STORE" -H "Content-Type: application/json" \\
  -d '{"event_id":"test-order-1","event_type":"order.created","occurred_at":"'"$NOW"'","order":{"external_id":"T-1","customer":{"name":"Test Person","email":"test@example.com"},"items":[{"sku":"TEST-1","name":"Test item","quantity":1}]}}'

# 3. A signup: {"status":"processed"}, or {"status":"ignored","reason":"signups_disabled"} until the shop owner switches signups on
curl -s -X POST "$BASE/customer-webhook" -H "Authorization: Bearer $KEY" -H "X-Store-Id: $STORE" -H "Content-Type: application/json" \\
  -d '{"event_id":"test-signup-1","event_type":"customer.created","occurred_at":"'"$NOW"'","customer":{"email":"new.person@example.com","name":"New Person"}}'

# 4. A stock update: expect {"status":"processed","applied":1}
curl -s -X POST "$BASE/inventory-webhook" -H "Authorization: Bearer $KEY" -H "X-Store-Id: $STORE" -H "Content-Type: application/json" \\
  -d '{"products":[{"sku":"TEST-1","name":"Test item","stock":11,"notify_on":5}],"synced_by":{"name":"Test Person","role":"Admin"}}'

# 5. Your products endpoint, the way WorkRelay calls it: it must answer 200 with JSON
curl -s -i "https://yourshop.com/workrelay/products" -H "Accept: application/json" -H "Authorization: Bearer YOUR_PRODUCTS_TOKEN"
\`\`\`

Then look in WorkRelay: **Orders**, **Customers**, **Inventory**, and **Integrations → Event history**, which lists every delivery with its status and the reason when something was refused.

### Go-live checklist

- [ ] The secret key is stored on the server only: never in browser code, logs, URLs or the repository
- [ ] Bind succeeded, and \`X-Store-Id\` is identical on every request
- [ ] Every order carries \`customer.email\`, and its items carry \`sku\` and \`name\`
- [ ] Events have stable, unique \`event_id\` values, and a retry reuses the same one
- [ ] Sending happens in the background with retries on network errors and \`5xx\`; \`4xx\` is logged, not retried unchanged
- [ ] (Signups) \`customer.created\` is sent when an account is created, and the shop owner switched on *Receive customer signups* and created the automation
- [ ] (Inventory) the products endpoint answers a valid feed behind its own token, **and/or** the button pushes the catalogue in chunks of 500
- [ ] (Inventory) if WorkRelay should also call you: WorkRelay set the schedule for this shop
- [ ] A test order, a test signup and a test stock update each show up in WorkRelay

## 8. When something is not showing up

| What you see | Most likely cause |
|---|---|
| An order is under Orders but the person is not under Customers | The order has **no email address**. Customers are matched by email only |
| A person who signed up is not on the Customers page | They have not ordered, and the default view only lists people who have. Choose **Registered only** or **All**. Those views appear once a shop sends signups |
| Signups are accepted but nobody is notified | No automation for *a customer signs up* covers this shop, **or** the signup happened before signups were switched on (history is saved, not announced), **or** it is a repeat for the same shop |
| \`202 ignored: signups_disabled\` | The shop owner has not switched on *Receive customer signups* for this shop. Switch it on, then resend |
| A product shows **Not reported** | No stock has been sent for it yet (it appeared from an order) |
| No calls arrive at your products endpoint | WorkRelay has not set a schedule for the shop, the URL is not entered, or the shop is paused. The **Sync now** button explains which |
| "The last check failed: …" | Read the message: a non-2xx answer, a body that is not JSON or not in the product format, a redirect, a private address, or a timeout over 15 seconds |
| An order shows a currency badge such as "USD, not MKD" | The order's \`currency\` differs from the shop's. Nothing was converted |

Anything the shop sends that is refused with \`400\` names the field in \`detail\` (never the value), so a retry with a fix will succeed. The same refusal is listed under **Failures** in WorkRelay, with a plain explanation and what to do about it. The full list of status codes and retry advice is in
section 7 of the [reference](./shop-webhook-integration.md).

Machine-readable schemas: [\`order-webhook.schema.json\`](./order-webhook.schema.json), [\`customer-webhook.schema.json\`](./customer-webhook.schema.json),
[\`product-feed.schema.json\`](./product-feed.schema.json).
`),U=/Base URL: `([^`]+)`/.exec(`# Connecting your shop to WorkRelay: the developer's guide

This is the practical guide for the developer of a shop that connects to WorkRelay. It says **what to build**, **what WorkRelay does with
it**, and **what the WorkRelay team switches on** on their side. For every field, status code and limit, the reference is
[\`shop-webhook-integration.md\`](./shop-webhook-integration.md); this guide links to it instead of repeating it.

- Base URL: \`https://wayktzmupzrdcwosgnfg.supabase.co/functions/v1\`
- You never log in to WorkRelay. You get a **secret key** and a **store id**, and everything else is HTTP.

## 1. What you build

| # | What | Direction | Required? | What it gives the shop's team |
|---|---|---|---|---|
| 1 | **Order webhook** | your shop → WorkRelay | **Yes** | Orders, a timeline per order, **customers**, and notifications for new orders and for a new customer's first order |
| 2 | **Customer signup webhook** | your shop → WorkRelay | Optional | A notification for **every new signup**, and people who registered but have not ordered yet |
| 3 | **Products endpoint** (we call it) | WorkRelay → your shop | Optional | Inventory kept up to date on a schedule, and low-stock alerts |
| 4 | **Inventory webhook** (a "Sync to WorkRelay" button) | your shop → WorkRelay | Optional | The same inventory, **immediately**, when someone presses the button |

Numbers 3 and 4 use the same product format and work together: the schedule keeps stock fresh by itself, and the button is the quick way
to refresh it on demand. You can build either one or both.

## 2. Who does what

Some switches live with the WorkRelay team, not in your code. Ask them for the ones marked **WorkRelay**.

| Setting | Who | Where |
|---|---|---|
| Create the connection, get the **secret key** (shown once) | Shop owner or admin, in WorkRelay | Integrations → Connect store |
| The shop's **currency** (one per shop) | Shop owner or admin; WorkRelay can also set it | Choose it when connecting; change it in Integrations → Edit |
| **Bind** the key to your store id (once) | **You**, from code | \`POST /bind\` |
| Receive customer signups (on/off per shop) | Shop owner or admin | Integrations → Edit → *Receive customer signups* |
| Notifications ("a customer signs up", "a new order arrives", "a shop syncs its products"…) | Shop owner or admin | Automations |
| **Schedule** for calls to your products endpoint (calls per days) | **WorkRelay** | Platform admin |
| Your products **URL** and its **token** | Shop owner or admin | API Calls → Inventory |

## 3. Start here: the order webhook

Everything else builds on orders, so do this first. Section 1 to 8 of the [reference](./shop-webhook-integration.md) describe it fully; the short
version:

1. **Bind once.** \`POST /bind\` with the key and your store id. From then on the key works for that store only.
2. **Send an event for every order change.** \`POST /order-webhook\` with \`Authorization: Bearer <key>\` and \`X-Store-Id: <store id>\`:
   \`order.created\` once, then \`order.updated\` or \`order.status_changed\` for each later change.
3. **Make events safe to retry.** Give each event a stable, unique \`event_id\`. Repeats are answered \`duplicate\`; older data never overwrites newer.

What matters most for the rest of this guide, so please include it **on every order**:

| Field | Why it matters |
|---|---|
| \`order.customer.email\` | **This is what makes a customer.** An order without an email address is stored, but no customer is created for it |
| \`order.customer.name\`, \`.phone\` | Shown on the customer |
| \`order.items[].sku\` and \`.name\` | Every item with a \`sku\` becomes a product in Inventory, and drives best-seller and sales numbers |
| \`order.currency\` | Optional: if you leave it out, the order takes the shop's currency (see section 6) |

\`\`\`json
{
  "event_id": "ord_1001:created",
  "event_type": "order.created",
  "occurred_at": "2026-10-27T10:00:00Z",
  "order": {
    "external_id": "1001",
    "order_number": "#1001",
    "customer": { "name": "Ana Petrova", "email": "ana@example.com", "phone": "+38970123456" },
    "totals": { "total_minor": 4999 },
    "items": [{ "sku": "TEE-BLK-M", "name": "Black tee (M)", "quantity": 1, "unit_price_minor": 4500 }]
  }
}
\`\`\`

**Times.** \`occurred_at\` is when the event is sent: within the last 7 days and no more than a day ahead, otherwise \`400\`. That leaves room to re-send after an outage. The real date of an older order goes in \`placed_at\` (any time from 2000-01-01), so importing history works. The dates in these examples are samples, so use the current time.

## 4. Customers

### How a customer is made

- **A customer is one person, identified by email address** (capital letters do not matter; spaces around it are not accepted, so send it trimmed). It is the only identity:
  your own customer id can be sent, but is stored for reference and never used to match people.
- **One customer across all of the workspace's shops.** The same email at two shops is one customer.
- WorkRelay creates a customer from **orders** by itself. You do not have to send anything extra for people to appear.

### Who appears where

| The person | Customers page |
|---|---|
| Has **at least one order** with an email address | Listed under **Placed an order** (the default view). A later cancellation does not remove them; cancelled orders are only left out of their order value |
| Ordered with **no email** on the order | Never a customer. The order is still under Orders |
| **Signed up but has not ordered** (you send signups) | Listed only under **Registered only** or **All**. These views appear once at least one shop sends signups |
| Ordered at two shops | One row in **All shops**, with order counts and value added up per currency. Pick a shop and you see only that shop's orders and value for them |

The **shop selector** on the Customers page limits the page to one shop: the people who ordered from it or signed up through it, with that
shop's own numbers.

### "A new customer's first order" (no extra work)

In Automations this is called **a new customer places their first order**. It needs only orders, so every shop has it. It fires **once per customer**, on their first order:

- An automation set to **all shops** fires on the customer's first order **anywhere in the workspace**.
- An automation limited to **chosen shops** fires for each ticked shop the first time that customer orders **from that shop**, even if they ordered
  at another shop before.

### "Every new signup" (what you need to do)

If the team wants a notification for **every new account**, the shop has to tell WorkRelay when one is created.

**You (the shop's developer):**

1. When an account is created, send \`POST /customer-webhook\` with the **same key and \`X-Store-Id\` as orders** (there is no second bind):

   \`\`\`json
   {
     "event_id": "cust_77:created",
     "event_type": "customer.created",
     "occurred_at": "2026-10-27T09:15:00Z",
     "customer": {
       "email": "ana@example.com",
       "name": "Ana Petrova",
       "phone": "+38970123456",
       "external_id": "cust_77",
       "registered_at": "2026-10-27T09:14:52Z"
     }
   }
   \`\`\`

2. Send it **at the moment of registration**, from a background job so a slow response never blocks sign-up. Retry network errors and 5xx with the same \`event_id\`.
3. Optionally send \`customer.updated\` (same shape) when a profile changes. It updates the person but never notifies.
4. To bring in **existing** accounts, send \`customer.created\` for each with their real \`registered_at\`. Anything that happened before signups were switched on is
   saved but **never notifies**, so an import does not flood the team.

**The shop owner (in WorkRelay):**

1. Integrations → **Edit** on the shop → turn on *Receive customer signups*. It is **off by default and per shop**. While it is off, events are kept and shown as
   ignored (HTTP 202); resend them after switching it on.
2. Automations → add one for **a customer signs up**, choose Discord, Slack or a webhook URL, and tick the shop(s) it should cover.

How notifications behave:

- **Once per customer and shop.** A retry, a repeat, or a second \`customer.created\` for the same person at the same shop never notifies twice.
- A signup through **another shop** notifies again (once for each shop), as long as an automation covers that shop.
- **Only \`customer.created\` notifies.** \`customer.updated\` does not.
- The notification is sent within seconds.

Not sure whether a shop sends signups? Customers shows a banner when you pick a shop that does, and the Customers views *Registered only* and *All* only appear
once one shop does.

## 5. Inventory

WorkRelay shows each product's stock and can alert the team when it runs low. **The shop is the source of truth**: WorkRelay shows what you report and never
subtracts stock on its own when an order arrives.

### The product format (the same for push and pull)

\`\`\`json
{
  "products": [
    {
      "sku": "BIKE-ROAD-700",
      "name": "Road bike 700c",
      "stock": 12,
      "notify_on": 5,
      "price_minor": 89900,
      "currency": "EUR",
      "unit": "pcs",
      "category": "Bikes",
      "barcode": "3850123456789",
      "updated_at": "2026-10-30T09:15:00Z"
    },
    { "sku": "NAIL-100", "stock": 4800, "notify_on": 5000 }
  ]
}
\`\`\`

- Only **\`sku\`** is required. Anything absent or \`null\` leaves the stored value as it is, so \`{"sku":"NAIL-100","stock":4800}\` is a complete, valid update.
- **Send the real stock, not a change.** \`stock: 11\` means "there are 11 now". It is safe to repeat and cannot drift. Never send "minus 1".
- **\`notify_on\`** is the shop's own low-stock number: the team is alerted when stock is **at or below** it (bikes at 5, nails at 5,000). The team can also override it per product
  in WorkRelay, and the override wins.
- **\`updated_at\`** (ISO 8601) is when the product last changed in your shop. A report older than what WorkRelay already holds never overwrites it, so a late retry cannot undo a newer update.
- Products are never deleted by a report; a product you stop sending simply keeps its last numbers.
- **Price:** if you send none, WorkRelay shows the latest price from an order line. Prices need a \`currency\`.

Products also appear on their own once an order contains an item with a \`sku\`; their stock then shows as "Not reported" until you report it.

### A. The products endpoint WorkRelay calls (scheduled)

Expose **one read-only \`GET\` endpoint** that returns the product format above. WorkRelay calls it on a schedule the WorkRelay team sets for the shop
(for example 15 calls a day, about every 1 hour 36 minutes).

\`\`\`
GET https://yourshop.com/workrelay/products
Accept: application/json
Authorization: <the value the shop owner entered in WorkRelay>
\`\`\`

What to build:

| Requirement | Detail |
|---|---|
| Method and URL | \`GET\`, **https**, a public address. The shop owner enters the URL in API Calls → Inventory |
| Authentication | Create a **dedicated read-only token** just for this. The shop owner enters it in WorkRelay, and it is sent as the \`Authorization\` header exactly as entered (for example \`Bearer abc123\`). It is stored privately and never shown again. **Do not reuse the WorkRelay secret key**: that one lets anyone write stock into your workspace, this one only lets WorkRelay read your catalogue. Compare it in constant time, and refuse everything else with \`401\` |
| Response | Any \`2xx\` with JSON: either \`{"products":[...]}\` or just the list \`[...]\` |
| Content | The full catalogue, or at least every product whose stock should stay current. Products you leave out are untouched, never deleted |
| Limits | **5,000 products and 5 MB** per answer, and it must answer within **15 seconds**. Larger catalogues are not supported yet |
| Redirects and addresses | Redirects are **not followed** (give the final URL), and the address must resolve to a **public** IP. Private networks, \`localhost\` and plain \`http\` are refused |
| Pagination | None: one request returns everything |
| Cost | Keep it cheap: read from a cache or a single query. A schedule can mean many calls a day |

If a call fails (not 2xx, not JSON, wrong shape, timeout), nothing from it is applied and the reason appears as **"The last check failed"** in API Calls → Inventory and in
Integrations → Event history. A failed call still counts toward the schedule.

The shop owner (or the team) can also press **Sync now** on the Inventory page to run a check immediately. It only works where WorkRelay has set a schedule for the shop, the
URL is entered, and the shop is not paused; each press uses one of the shop's scheduled calls, so it can never exceed the agreed number.

### B. The "Sync to WorkRelay" button (your shop pushes)

For an instant update, add a button to **your own admin** that sends the catalogue to WorkRelay.

\`\`\`
POST https://wayktzmupzrdcwosgnfg.supabase.co/functions/v1/inventory-webhook
Authorization: Bearer <the secret key>
X-Store-Id: <your store id>
Content-Type: application/json

{"products":[{"sku":"BIKE-ROAD-700","stock":11}],"synced_by":{"name":"Marko","role":"Admin"}}
\`\`\`

- Up to **500 products and 1 MB per request**. For a bigger catalogue, send it in chunks of 500, one after the other.
- Run it **in the background** and show progress ("sent 1,500 of 4,200"), so the button never hangs the admin page.
- On a network error or \`5xx\`, retry with the same body (it is safe to repeat). On \`400\`, read \`detail\`, which names the field to fix. Do not retry a \`400\` unchanged.
- **Nothing to switch on.** Any connected shop can push, at any time and as often as it likes. There is no limit on pushes: the "calls per days" WorkRelay sets only limit WorkRelay's own calls to your products endpoint.
- **Say who pressed it.** Put the signed-in admin in \`synced_by\` (\`name\` and \`role\`, both optional). If the team has an automation for **a shop syncs its products**, it announces
  *"Marko (Admin) has synced their products (Game Store)"* in Discord, Slack or a webhook. A sync sent as several chunks is announced **once** (same shop, same person, each request within 90 seconds of the previous one); pressing the button again after a pause is announced again.
  Without \`synced_by\`, the message names the shop instead.
- **Where it shows.** Every applied push updates the shop's "Synced 12m ago, sent by Marko (Admin)" line on the Inventory page, and a push also appears in the Live feed on the Overview.
- **WorkRelay decides who is notified, not the request.** There is nothing in the push to turn the notification on or off. The team controls it in WorkRelay: the automation can be switched
  off, or limited to some shops. If your shop also pushes automatically on a timer or after each sale, tell the team, so they can leave that shop out of the automation or have WorkRelay switch it off.
  Scheduled calls from WorkRelay and its **Sync now** button never announce.
- Each push (and each scheduled call) appears in Integrations → Event history as \`inventory.push\` or \`inventory.pull\`, with a short summary, for 30 days.
- Every sync, pushed by the shop or asked for by WorkRelay, also appears in **Inventory → Sync history**: when, which shop, who started it (your \`synced_by\`), how many products, which ones changed (stock before and after), and the reason when it failed. Kept for 30 days.

Besides the button, you can also push whenever a product's stock changes (after a sale, a restock or an admin edit). Batch changes for a few seconds so a busy shop sends one request, not one per order.

### Which should you build?

- **Smallest useful setup:** the products endpoint (A). WorkRelay does the rest on its schedule.
- **Recommended:** A plus the button (B): fresh stock on a schedule, and instant when someone needs it.
- **Cannot expose a public endpoint** (for example the shop sits behind a firewall): do B only, and add a scheduled job on your side that pushes every 10 to 15 minutes.

## 6. Currency

Each shop has **one currency**, set in WorkRelay, and WorkRelay **never converts** between currencies.

- An order sent **without** a \`currency\` takes the shop's.
- An order sent **with the shop's currency** is used as it is.
- An order sent with a **different** currency is kept exactly as sent and marked as a currency mismatch on the order, so a wrongly configured shop is easy to spot. Correct the payload (or ask for the shop's currency to be corrected) and resend.

## 7. Test it

Replace the key, store id and URLs with your own.

\`\`\`bash
BASE=https://wayktzmupzrdcwosgnfg.supabase.co/functions/v1
KEY=wr_live_...
STORE=your-store-id

# 1. Bind once
curl -s -X POST "$BASE/bind" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d "{\\"store_id\\":\\"$STORE\\"}"

# Events must be recent (within the last 7 days), so the examples below stamp themselves with the current time
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 2. An order with a customer: expect {"status":"processed"}, then the person appears under Customers
curl -s -X POST "$BASE/order-webhook" -H "Authorization: Bearer $KEY" -H "X-Store-Id: $STORE" -H "Content-Type: application/json" \\
  -d '{"event_id":"test-order-1","event_type":"order.created","occurred_at":"'"$NOW"'","order":{"external_id":"T-1","customer":{"name":"Test Person","email":"test@example.com"},"items":[{"sku":"TEST-1","name":"Test item","quantity":1}]}}'

# 3. A signup: {"status":"processed"}, or {"status":"ignored","reason":"signups_disabled"} until the shop owner switches signups on
curl -s -X POST "$BASE/customer-webhook" -H "Authorization: Bearer $KEY" -H "X-Store-Id: $STORE" -H "Content-Type: application/json" \\
  -d '{"event_id":"test-signup-1","event_type":"customer.created","occurred_at":"'"$NOW"'","customer":{"email":"new.person@example.com","name":"New Person"}}'

# 4. A stock update: expect {"status":"processed","applied":1}
curl -s -X POST "$BASE/inventory-webhook" -H "Authorization: Bearer $KEY" -H "X-Store-Id: $STORE" -H "Content-Type: application/json" \\
  -d '{"products":[{"sku":"TEST-1","name":"Test item","stock":11,"notify_on":5}],"synced_by":{"name":"Test Person","role":"Admin"}}'

# 5. Your products endpoint, the way WorkRelay calls it: it must answer 200 with JSON
curl -s -i "https://yourshop.com/workrelay/products" -H "Accept: application/json" -H "Authorization: Bearer YOUR_PRODUCTS_TOKEN"
\`\`\`

Then look in WorkRelay: **Orders**, **Customers**, **Inventory**, and **Integrations → Event history**, which lists every delivery with its status and the reason when something was refused.

### Go-live checklist

- [ ] The secret key is stored on the server only: never in browser code, logs, URLs or the repository
- [ ] Bind succeeded, and \`X-Store-Id\` is identical on every request
- [ ] Every order carries \`customer.email\`, and its items carry \`sku\` and \`name\`
- [ ] Events have stable, unique \`event_id\` values, and a retry reuses the same one
- [ ] Sending happens in the background with retries on network errors and \`5xx\`; \`4xx\` is logged, not retried unchanged
- [ ] (Signups) \`customer.created\` is sent when an account is created, and the shop owner switched on *Receive customer signups* and created the automation
- [ ] (Inventory) the products endpoint answers a valid feed behind its own token, **and/or** the button pushes the catalogue in chunks of 500
- [ ] (Inventory) if WorkRelay should also call you: WorkRelay set the schedule for this shop
- [ ] A test order, a test signup and a test stock update each show up in WorkRelay

## 8. When something is not showing up

| What you see | Most likely cause |
|---|---|
| An order is under Orders but the person is not under Customers | The order has **no email address**. Customers are matched by email only |
| A person who signed up is not on the Customers page | They have not ordered, and the default view only lists people who have. Choose **Registered only** or **All**. Those views appear once a shop sends signups |
| Signups are accepted but nobody is notified | No automation for *a customer signs up* covers this shop, **or** the signup happened before signups were switched on (history is saved, not announced), **or** it is a repeat for the same shop |
| \`202 ignored: signups_disabled\` | The shop owner has not switched on *Receive customer signups* for this shop. Switch it on, then resend |
| A product shows **Not reported** | No stock has been sent for it yet (it appeared from an order) |
| No calls arrive at your products endpoint | WorkRelay has not set a schedule for the shop, the URL is not entered, or the shop is paused. The **Sync now** button explains which |
| "The last check failed: …" | Read the message: a non-2xx answer, a body that is not JSON or not in the product format, a redirect, a private address, or a timeout over 15 seconds |
| An order shows a currency badge such as "USD, not MKD" | The order's \`currency\` differs from the shop's. Nothing was converted |

Anything the shop sends that is refused with \`400\` names the field in \`detail\` (never the value), so a retry with a fix will succeed. The same refusal is listed under **Failures** in WorkRelay, with a plain explanation and what to do about it. The full list of status codes and retry advice is in
section 7 of the [reference](./shop-webhook-integration.md).

Machine-readable schemas: [\`order-webhook.schema.json\`](./order-webhook.schema.json), [\`customer-webhook.schema.json\`](./customer-webhook.schema.json),
[\`product-feed.schema.json\`](./product-feed.schema.json).
`)?.[1]??``;function W(e){document.getElementById(e)?.scrollIntoView({behavior:window.matchMedia(`(prefers-reduced-motion: reduce)`).matches?`auto`:`smooth`})}var G=[{id:`start-here-the-order-webhook`,title:`Connecting a shop for the first time`,line:`Bind the key and send your first order.`},{id:`customers`,title:`Customers and signup alerts`,line:`How a person is made, and what you send to notify on every signup.`},{id:`inventory`,title:`Stock, and alerts when it runs low`,line:`Let WorkRelay fetch your products, or push them from a button.`},{id:`test-it`,title:`Trying it from a terminal`,line:`Five commands, with what each one should answer.`},{id:`when-something-is-not-showing-up`,title:`Something is not showing up`,line:`Symptoms and their most likely causes.`}];function K(e){let[t,n]=(0,u.useState)(e[0]??``);return(0,u.useEffect)(()=>{let t=new Map,r=new IntersectionObserver(r=>{for(let e of r)t.set(e.target.id,e.isIntersecting);let i=e.find(e=>t.get(e));i&&n(i)},{rootMargin:`-80px 0px -70% 0px`});return e.forEach(e=>{let t=document.getElementById(e);t&&r.observe(t)}),()=>r.disconnect()},[e]),t}function q({sections:e,active:t,onPick:n}){return(0,C.jsx)(`ul`,{className:`space-y-0.5`,children:e.map(e=>{let r=e.id===t;return(0,C.jsx)(`li`,{children:(0,C.jsxs)(`button`,{type:`button`,"aria-current":r?`location`:void 0,onClick:()=>{W(e.id),n?.()},className:`group flex w-full items-start gap-3 rounded py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring`,children:[(0,C.jsx)(`span`,{"aria-hidden":!0,className:`lamp mt-[0.5em] size-1.5 shrink-0 rounded-full`,"data-on":r}),(0,C.jsx)(`span`,{className:r?`font-medium text-foreground`:`text-muted-foreground transition-colors group-hover:text-foreground`,children:e.text})]})},e.id)})})}function J(e){let t=e.find(e=>e.t===`heading`&&e.level===1),n=e.findIndex(e=>e.t===`heading`&&e.level===2),r=e.indexOf(t)+1,i=e.slice(r,n).map(e=>e.t===`list`?{...e,items:e.items.filter(e=>!S(e.inline).startsWith(`Base URL`))}:e),a=e.slice(n),o=a.filter(e=>e.t===`heading`&&e.level===2).map(e=>({id:e.id,text:e.text}));return{title:t&&t.t===`heading`?t.text:`Developer guide`,intro:i,body:a,sections:o}}function Y(){let{title:e,intro:n,body:i,sections:o}=(0,u.useMemo)(()=>J(H),[]),s=K((0,u.useMemo)(()=>o.map(e=>e.id),[o])),[l,d]=(0,u.useState)(!1);return(0,u.useEffect)(()=>(document.title=`Dev Docs · WorkRelay`,()=>{document.title=`WorkRelay`}),[]),(0,C.jsxs)(`div`,{className:`world min-h-dvh`,children:[(0,C.jsx)(c,{nav:(0,C.jsxs)(C.Fragment,{children:[(0,C.jsx)(`a`,{href:`#/`,className:a,children:`Overview`}),(0,C.jsx)(`a`,{href:`#/docs`,"aria-current":`page`,className:a,children:`Dev Docs`})]})}),(0,C.jsxs)(`main`,{className:`mx-auto max-w-[1200px] px-6 pt-12 pb-24 sm:pt-16 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16`,children:[(0,C.jsxs)(`aside`,{className:`lg:sticky lg:top-24 lg:self-start`,children:[(0,C.jsxs)(`details`,{open:l,onToggle:e=>d(e.currentTarget.open),className:`mb-10 border-y py-3 lg:hidden`,children:[(0,C.jsx)(`summary`,{className:`cursor-pointer text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring`,children:`On this page`}),(0,C.jsx)(`div`,{className:`mt-3`,children:(0,C.jsx)(q,{sections:o,active:s,onPick:()=>d(!1)})})]}),(0,C.jsxs)(`nav`,{"aria-label":`On this page`,className:`hidden lg:block`,children:[(0,C.jsx)(`p`,{className:`mb-3 text-sm font-medium`,children:`On this page`}),(0,C.jsx)(q,{sections:o,active:s}),(0,C.jsxs)(`p`,{className:`mt-8 text-sm text-muted-foreground`,children:[`Every field, status code and limit is in the`,` `,(0,C.jsx)(`a`,{href:`https://github.com/StefanMarkoski/WorkRelay/blob/main/documentation/shop-webhook-integration.md`,target:`_blank`,rel:`noopener noreferrer`,className:`font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground`,children:`full reference`}),`.`]})]})]}),(0,C.jsxs)(`article`,{className:`min-w-0`,children:[(0,C.jsx)(`h1`,{className:`max-w-[20ch] font-display text-balance text-[2.5rem] leading-[1.02] font-semibold tracking-[-0.03em] sm:text-5xl`,children:e}),(0,C.jsx)(`div`,{className:`mt-6 space-y-4 text-lg text-muted-foreground [&_a]:text-foreground [&_p]:max-w-[60ch] [&_strong]:text-foreground`,children:(0,C.jsx)(V,{blocks:n})}),U&&(0,C.jsxs)(`div`,{className:`housing mt-8 flex max-w-xl items-center justify-between gap-3 py-2.5 pr-2 pl-4`,children:[(0,C.jsxs)(`div`,{className:`min-w-0`,children:[(0,C.jsx)(`p`,{className:`font-mono text-[11px] tracking-wide text-muted-foreground`,children:`BASE URL`}),(0,C.jsx)(`p`,{className:`truncate font-mono text-[13px]`,children:U})]}),(0,C.jsx)(F,{text:U,label:`Copy the base URL`})]}),(0,C.jsxs)(`nav`,{"aria-label":`Where to start`,className:`mt-12`,children:[(0,C.jsx)(`h2`,{className:`font-display text-xl font-semibold tracking-tight`,children:`Where to start`}),(0,C.jsx)(`ul`,{className:`mt-4 divide-y border-y`,children:G.map(e=>(0,C.jsx)(`li`,{children:(0,C.jsxs)(`button`,{type:`button`,onClick:()=>W(e.id),className:`group flex w-full items-center justify-between gap-4 py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring`,children:[(0,C.jsxs)(`span`,{children:[(0,C.jsx)(`span`,{className:`block font-medium`,children:e.title}),(0,C.jsx)(`span`,{className:`block text-sm text-muted-foreground`,children:e.line})]}),(0,C.jsx)(t,{"aria-hidden":!0,className:`size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground`})]})},e.id))})]}),(0,C.jsx)(`div`,{className:`mt-20 space-y-5`,children:(0,C.jsx)(V,{blocks:i})})]})]}),(0,C.jsx)(`footer`,{className:`border-t`,children:(0,C.jsxs)(`div`,{className:`mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-6 py-8 text-sm text-muted-foreground`,children:[(0,C.jsxs)(`span`,{children:[`© `,new Date().getFullYear(),` WorkRelay`]}),(0,C.jsx)(`span`,{children:`Examples in these docs use sample keys and invented data.`}),(0,C.jsx)(`div`,{className:`sm:hidden`,children:(0,C.jsx)(r,{})})]})})]})}export{Y as default};