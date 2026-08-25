# Phase 3 — Orders (no money yet)

Deliberately no payment provider in this phase. Prove the whole order lifecycle
works while mistakes are still free to fix.

## What gets built

### Cart
- Server-side, tied to the logged-in user — not browser storage. An agency
  builds a batch over days and switches devices.
- Cart lines reference a `Site` and belong to a `Project`.
- Show a live warning when the cart contains two placements on the same site for
  the same project. Legitimate occasionally, usually a mistake, always worth flagging.

### Order draft
- Cart converts to an `Order` with status `DRAFT`.
- Per item, the advertiser supplies: `targetUrl`, `anchorText`, `contentSource`
  (`ADVERTISER` or `PLATFORM`).
- Validate `targetUrl` is a well-formed absolute URL and its host matches the
  project's `targetUrl` host. Warn rather than block on mismatch — agencies do
  sometimes point at a client subdomain.
- `anchorText` required, trimmed, 1–120 chars.

### Placement
On placing the order:
1. **Snapshot `priceCents` and `costCents` onto each `OrderItem`.** Later catalog
   price changes must never alter this order. This is a hard rule from CLAUDE.md.
2. Generate `reference` as `ORD-YYYY-NNNNN`, sequential within the year.
3. Set status to `IN_PROGRESS` (no `PENDING_PAYMENT` until Phase 5).
4. Freeze the order. After placement the advertiser can no longer change items,
   only cancel individual items while they are still `QUEUED`.

### Idempotency
Placing an order must be idempotent on a client-supplied key. A double-click, a
flaky connection, or a browser back-and-resubmit must never create two orders.
Test this explicitly — it is much harder to retrofit once money is involved.

### Status pipeline
One function owns every transition, with an explicit allowed-transitions map.
No `status = 'PUBLISHED'` assignments scattered through route handlers.

```
QUEUED              → CONTENT_PENDING | SUBMITTED_TO_PUBLISHER | REJECTED
CONTENT_PENDING     → SUBMITTED_TO_PUBLISHER | REJECTED
SUBMITTED_TO_PUBLISHER → PUBLISHED | REVISION_REQUESTED | REJECTED
REVISION_REQUESTED  → SUBMITTED_TO_PUBLISHER | REJECTED
PUBLISHED           → VERIFIED | REVISION_REQUESTED
VERIFIED            → REFUNDED
REJECTED            → (terminal)
REFUNDED            → (terminal)
```

Anything not in this map throws. `PUBLISHED` requires a non-empty `publishedUrl`.

The parent `Order` status is derived from its items, never set directly:
- any item not terminal → `IN_PROGRESS`
- all terminal, some `VERIFIED` → `COMPLETE`
- all terminal, none `VERIFIED` → `CANCELLED`
- mixed terminal and complete → `PARTIALLY_COMPLETE`

### Audit trail
Every status change writes a row: item, from, to, actor user ID, timestamp,
optional note. This is what support and refund disputes run on later. Add it now;
retrofitting history is impossible because the past is already gone.

### Advertiser order pages
- Order list: reference, project, date, item count, total, derived status.
- Order detail: per-item status, published URL when live, anchor and target,
  and the item's history from the audit trail.
- Filter by project and by status.

### Admin order queue
- Filter by item status, assign an item to an `EDITOR`.
- Change item status through the transition function, with a note field.
- Paste `publishedUrl` when marking `PUBLISHED`.
- Show `costCents` and margin here — admin only, never on advertiser routes.

## Out of scope for Phase 3

- Payment, wallet holds, invoices — Phase 5
- Automated link checking — Phase 6
- Advertiser-publisher messaging — never
- File upload for articles. Use a plain URL field for now; real uploads add
  storage, virus scanning, and access control that would stall this phase.

## Acceptance tests

Write these before the features.

1. Placing an order snapshots prices. Change the site's `priceCents` afterward
   and assert the order total is unchanged.
2. `costCents` appears on no advertiser-facing order route.
3. Submitting the same idempotency key twice creates exactly one order.
4. An invalid transition (e.g. `QUEUED` → `VERIFIED`) throws and changes nothing.
5. `PUBLISHED` without a `publishedUrl` is rejected.
6. Order status is derived correctly for all-verified, all-rejected, and mixed cases.
7. User B cannot read, cancel, or modify user A's order or any of its items.
8. An order with zero items cannot be placed.
9. Every status change produces exactly one audit row with the correct actor.

## Done when

A staff member can take an order from placement to `COMPLETE` entirely through
the admin UI, the advertiser sees each change reflected on their order page, and
all nine tests pass.
