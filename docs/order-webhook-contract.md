# Order webhook contract (v1)

Sent by the commerce app to WorkRelay after the store has been bound with the WorkRelay secret key.

## Authentication
- `Authorization: Bearer wr_live_...` identifies the integration (and so the organization and store).
- Requests must be sent over HTTPS. Also send `X-Store-Id: <your store id>`; it must match the store given at bind time.
- Organization/store identifiers in the body are ignored.

## Body
```json
{
  "event_id": "evt_123",
  "event_type": "order.created | order.updated | order.status_changed",
  "occurred_at": "2026-10-27T10:00:00Z",
  "order": { "external_id": "1001", "...optional fields..." : null }
}
```

## Required
`event_id`, `event_type`, `occurred_at`, `order.external_id`. Everything else is optional.

## Semantics
- Absent field = unchanged/unknown. Explicit `null` = clear.
- Money: integer minor units (cents) plus a 3-letter `currency`. No currency => order flagged `missing_currency`.
- `items`, when present, replaces the whole item list.
- Unknown statuses are stored as `unknown` with the original string kept.
- Duplicate `event_id` for the same integration => acknowledged, not reprocessed.
- Out-of-order events are recorded on the timeline; a field group is only overwritten by an event newer than the last one applied to it.
- Unsupported `event_type` => recorded as `ignored` (HTTP 202).

## Responses
200 processed/duplicate, 202 ignored, 400 invalid (recorded as `failed`), 401 bad key/signature, 403 key bound to a different store.
