# Phase 4 — Internal admin

This is the tool your own team lives in all day. It is not customer-facing, so
skip the polish, but the data rules below are strict because everything
downstream depends on them.

## Roles

Two internal roles, and they see different things.

- **ADMIN** — sets pricing, sees `costCents` and margin, manages publishers,
  imports catalog.
- **EDITOR** — fulfils orders. Sees the order queue, publisher contact details
  for sites they are assigned, and can move item statuses. Must **not** see
  `costCents`, margin, or the pricing screens.

Enforce at the data layer, not by hiding buttons.

## Site management

### CRUD
- Create, edit, deactivate. **Never hard-delete a Site** — existing `OrderItem`
  rows reference it and history must stay intact. `isActive: false` removes it
  from the catalog and nothing else.
- Edit form shows `costCents`, `priceCents`, and computed margin side by side,
  both in currency and percent.
- Block saving when `priceCents <= costCents`. Require an explicit override
  checkbox with a reason, and log it. Selling at a loss should be a decision,
  not a typo.

### Price history
New table: site ID, old cost, new cost, old price, new price, actor, timestamp.

Orders already snapshot their prices, so this is not for billing — it is for
answering "why did our margin drop last quarter" and for spotting a publisher
who quietly raised rates three times in a year.

### Bulk CSV import
This is how the catalog actually grows. Manual entry does not scale past ~50 sites.

- Upload CSV, match on `domain` as the unique key.
- **Dry run first.** Show a preview: N new, N updated, N unchanged, N errors,
  with the specific row and reason for each error. Nothing is written until the
  admin confirms.
- Validate: domain format, country is ISO-2, language is ISO-639-1, prices are
  positive integers, `acceptsSensitive` values are from the known list, category
  slugs exist.
- Unknown category slugs are an error, not an auto-create. Otherwise typos
  silently fragment your taxonomy into "technology" and "techonlogy".
- Import is transactional — a failure partway through rolls back completely.
- Log every import: who, when, file name, row counts.

Expected columns:

```
domain, country, language, categories, cost, price, writing_price,
turnaround_days, link_type, max_links, min_words, guarantee_days,
accepts_sensitive, publisher_name, publisher_email, publisher_telegram, notes
```

`categories` and `accepts_sensitive` are semicolon-separated.

## Publisher management

- CRUD on `Publisher`. One publisher owns many sites.
- Contact fields, payout notes, free-text correspondence log.
- **Reliability score**, computed not hand-entered. Derive from delivery history:
  on-time publish rate, rejection rate, average days over quoted turnaround, and
  count of links that later went dead. Recompute on every item status change.
- Show the score on the site edit screen too, so pricing decisions see it.
- Never expose any of this on an advertiser route.

## Order queue

Extends the basic admin from Phase 3.

- Filter by item status, assignee, site country, and age.
- **Overdue view** — items past `turnaroundDays` since `SUBMITTED_TO_PUBLISHER`.
  This is the screen your fulfilment lead opens first every morning.
- Assign and reassign items to an `EDITOR`; bulk assign a selection.
- Correspondence log per item: what was sent to the publisher and when.
- Every status change still goes through the Phase 3 transition function.

## Admin audit log

Every write in admin records actor, action, entity, before/after, timestamp.
Site pricing edits, publisher edits, imports, status overrides, refunds.

You will need this the first time a number looks wrong and nobody remembers
changing it.

## Acceptance tests

1. An `EDITOR` receives 404 on every pricing route, and `costCents` appears in no
   response served to an `EDITOR`.
2. Deleting a site is impossible; deactivating removes it from the catalog while
   existing orders still render its domain correctly.
3. Saving `price <= cost` is blocked without an override, and the override is logged.
4. A CSV with one bad row imports nothing and reports that row precisely.
5. Re-importing the same CSV twice produces no duplicate sites.
6. Reliability score changes as expected when an item is marked late or rejected.
7. Publisher contact details appear on no advertiser-facing route.
8. Every admin write produces exactly one audit row.

## Done when

A staff member can add 50 sites by CSV, correct a pricing error, assign an
overdue placement to a colleague, and take an order to completion — without
anyone opening a database client.
