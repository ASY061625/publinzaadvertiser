# Gated catalog — approved accounts only

Nothing about the catalog is visible until an account exists **and** has been
approved by staff. This replaces the public preview described in
MARKETING-SITE.md.

---

## 1. Account states

Add `status` to `User`:

```
PENDING    — signed up, awaiting review. Default on signup.
APPROVED   — full catalog and ordering access.
REJECTED   — terminal. No access.
SUSPENDED  — was approved, access revoked.
```

Also capture at signup, because you need something to review:
company name, website, role, and what they're promoting.

### Guards
- Every catalog, site-detail, search, and order route requires `APPROVED`.
- Enforce in the shared data-access layer, not per route handler. Same rule as
  the Phase 2 tenant isolation — one place, no exceptions.
- `PENDING` users see a single holding page and nothing else. No site counts, no
  sample rows, no filter UI skeleton that hints at inventory.
- `REJECTED` users see the same holding page. **Never state the reason** — it
  just tells a competitor how to pass on the second attempt.

### Emails
- On signup: what happens next and the expected turnaround.
- On approval: a direct link into the catalog.
- On rejection: a neutral "we're not able to open an account at this time".

---

## 2. Approval queue

Admin screen listing `PENDING` accounts with their signup details, sorted oldest
first.

**Approval speed is a conversion metric.** Someone who signs up and waits three
days has already bought from a competitor. Target same business day, and show
that promise on the signup page so the wait is expected rather than alarming.

Once you have volume, add auto-approval rules — a corporate email domain with a
matching live website clears most legitimate buyers — and keep manual review for
free-email signups and anything that looks like a competitor.

Log who approved or rejected each account and when.

---

## 3. Marketing site changes

Remove:
- `/catalog` public preview
- All programmatic `/catalog/country/*` and `/catalog/niche/*` pages
- Any sample rows, prices, or masked domains on the homepage

Replace the homepage catalog section and primary CTA with a signup path:
**"Request access"** rather than "Browse the catalog".

### What you can still show publicly

Aggregate figures reveal nothing about individual sites and still let buyers
judge whether you're worth signing up for:

> 14 finance publications in Germany. Domain rating 40–70.
> Traffic 30K–200K monthly. Placements from $180 to $600.

This is the substitute for the programmatic catalog pages. Build one page per
niche and per country using aggregates only — enough to rank, enough to
qualify a buyer, nothing a competitor can act on.

Keep public: pricing model, guarantee, vetting standard, how it works, blog,
about, legal. Gating the inventory is not a reason to hide how you operate — the
vetting standard is now doing even more work, because it's the only proof of
quality a visitor can see before committing.

---

## 4. SEO consequence

Losing the catalog pages removes your largest source of long-tail organic
traffic. Compensate on three fronts:

1. **Aggregate niche and country pages** as above — these can rank for
   "guest posting sites Germany" style queries without listing anything.
2. **Blog, weighted heavier than before.** It's now your main organic surface.
3. **Direct outreach**, which matters more in a gated model. You're no longer
   discovered by browsing, so you have to go and find buyers.

Expect gating to reduce signups and raise their average quality. That trade is
defensible with a small curated catalog. It would not be with a large one.

---

## 5. Protecting the catalog after login

Approval slows a competitor down; it doesn't stop one who gets through.

- Per-account rate limits on catalog search and pagination.
- Flag accounts whose browsing looks like enumeration — very high page counts,
  sequential paging through everything, no orders placed.
- Log every catalog export. If you offer CSV export, cap it and record who took
  what.
- Review accounts that browse heavily for 30 days and never order.

Don't over-engineer this at launch. Rate limits plus a monthly look at the
outliers is proportionate.

---

## 6. Acceptance tests

1. An unauthenticated request to any catalog or site route returns 404 or a
   redirect to signup — never partial data.
2. A `PENDING` user gets the holding page on every catalog route, and no API
   endpoint returns site data to them.
3. A `REJECTED` user's response is byte-identical to a `PENDING` user's.
4. A `SUSPENDED` user loses access immediately, including existing sessions.
5. No site domain, price, or metric appears anywhere in the marketing site's
   built output.
6. Approving a user grants access without requiring re-login.
7. Every approval and rejection writes an audit row with the actor.
