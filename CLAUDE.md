# Outpost — advertiser-side placement marketplace

## What this is

A guest-post / digital-PR marketplace with **one user type: the advertiser**. Publishers have
no login and no self-serve UI. The site catalog and publisher contacts are managed internally by
staff, and placements are fulfilled by an internal team. Advertisers browse the catalog, pay, and
track placements to a verified live link.

Global catalog, all niches. Launch inventory will be narrow; the schema must not assume that.

## Non-negotiable rules

These are business-critical. Do not relax them for convenience.

1. **`Site.costCents` must never leave the server.** It is what we pay the publisher. Every
   catalog serializer, API response, CSV export, and error payload must omit it. Add a test that
   asserts this for the public catalog endpoint.
2. **Prices are snapshotted onto `OrderItem` at purchase.** Later catalog price changes must never
   alter an existing order's totals.
3. **Funds are held, not captured, until an item is `VERIFIED`.** Wallet ledger is append-only —
   correct mistakes with a compensating `ADJUSTMENT` row, never by editing history.
4. **Every published URL is re-crawled on a schedule** for the full `guaranteeDays` window. The
   `LinkCheck` history is the evidence for refunds; it is not optional.
5. **Never expose publisher contact details** (`Publisher.email`, `.telegram`) through any
   advertiser-facing route. The whole business model depends on this.

## Stack

- Next.js (App Router) + TypeScript
- Postgres via Prisma — schema is in `prisma/schema.prisma`
- Auth.js (email + password, magic link later)
- Tailwind + shadcn/ui — but the catalog list view follows the existing prototype's dense layout,
  not default card styling
- Stripe for cards, Razorpay for India — behind a single `PaymentProvider` interface
- Background jobs: Inngest or a plain cron route (link checks, metrics refresh)
- Deploy: Vercel + Neon/Supabase

## Build phases

Ship each phase to a working state before starting the next. Do not build payments early.

### Phase 1 — Catalog (read path)
- Prisma schema applied, seed script with ~60 sites across mixed countries/niches
- `GET /api/sites` with filtering: topic, country, language, DR range, traffic floor, price range,
  dofollow, analytics-verified, turnaround, restricted-topic acceptance
- Sorting by DR, traffic, price, turnaround. Keyset pagination, not offset.
- Composite indexes chosen from the real filter combinations, not guessed
- Catalog UI ported from the prototype, including the selection tray with DR spread and the
  single-country concentration warning
- **Done when:** filtering 5,000 seeded rows returns in under 150ms and `costCents` appears
  nowhere in the response.

### Phase 2 — Accounts and projects
- Signup, login, password reset
- Projects (name, target domain), project switcher in the top bar
- Role guard: `ADVERTISER` cannot reach any `/admin` route
- **Done when:** two advertisers cannot see each other's projects, proven by a test.

### Phase 3 — Orders (no money yet)
- Cart → order draft → per-item target URL, anchor text, content source
- Order reference generator (`ORD-YYYY-NNNNN`)
- Item status pipeline: QUEUED → CONTENT_PENDING → SUBMITTED_TO_PUBLISHER → PUBLISHED → VERIFIED,
  with REVISION_REQUESTED / REJECTED / REFUNDED as branches
- Advertiser order detail page showing per-item status and published URL
- **Done when:** an order can be walked end to end by changing statuses manually in admin.

### Phase 4 — Internal admin
- Site CRUD with cost/price side by side and computed margin
- Publisher contact records, reliability score from delivery history
- Order queue: filter by status, assign to an `EDITOR`, log publisher correspondence
- Bulk CSV import for sites (this is how catalog actually grows)
- **Done when:** a staff member can run a full order without touching the database.

### Phase 5 — Money
- Wallet top-up via Stripe/Razorpay, webhook-driven, idempotent on provider event ID
- `ORDER_HOLD` on placement, `ORDER_CAPTURE` on verification, `REFUND` on rejection
- Invoices (PDF), VAT/GST fields on the user record
- **Done when:** replaying the same webhook twice does not double-credit a wallet.

### Phase 6 — Metrics and guarantees
- DataForSEO integration populating `SiteMetric`, scheduled refresh, staleness indicator in the UI
- Failed metrics refresh must not block catalog edits or hide a site
- Link checker cron writing `LinkCheck` rows; alert staff when a verified link disappears
- **Done when:** removing a link from a test page surfaces an alert within one cron cycle.

## Out of scope — do not build

- Publisher registration, publisher dashboard, publisher payouts UI
- Bidding, negotiation, or publisher-set pricing
- Internal messaging between advertiser and publisher
- Anything that reveals which publisher owns which site

## Conventions

- Money is integer cents everywhere. No floats, no currency math in the UI layer.
- All catalog filtering happens in SQL. Never fetch-then-filter in JS.
- Server components for the catalog shell; the filter rail and tray are client components.
- Every status transition goes through one function with an explicit allowed-transitions map.
  No scattered `status = 'PUBLISHED'` assignments.
