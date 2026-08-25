# Phase 6 — Metrics and guarantees

Two background systems. One keeps your catalog data honest; the other keeps your
promise that links stay live. The second is what makes the product trustworthy.

## Metrics pipeline

### Source
DataForSEO to start — cheapest per lookup and covers DR-equivalent, traffic,
referring domains, and spam signals. Ahrefs or Semrush later if volume justifies
the cost.

### Rules
- Writes to `SiteMetric` only. Never blocks catalog edits.
- **A failed refresh must never hide a site or zero its metrics.** Keep the last
  known values and the `fetchedAt` timestamp. A site whose metrics call errored
  is a site with stale data, not a site with no traffic.
- Show staleness in the UI once data passes ~30 days. Advertisers making a $500
  decision deserve to know the DR they're looking at is two months old.
- Sites with no metrics at all sort last and are excluded from any metric-based
  filter. Already covered by the Phase 1 tests — don't regress it.

### Cost control
Metrics lookups cost money per domain, and a naive nightly refresh of the whole
catalog will quietly become one of your larger line items. Tier the cadence:

- Ordered or viewed in the last 30 days → weekly
- Active, not recently viewed → monthly
- Inactive → on demand only

Batch requests, cap daily spend, and alert if the cap is hit rather than silently
stopping.

## Link verification

This is the guarantee. It runs for the full `guaranteeDays` window on every
`VERIFIED` item.

### What a check records
For each `OrderItem` with a `publishedUrl`, write a `LinkCheck` row containing
HTTP status, whether the target link is present, the `rel` attribute as actually
rendered, the final URL after redirects, and whether the page is indexed.

### Failure modes to distinguish
These are different problems with different responses. Do not collapse them into
one boolean.

| What happened | Signal |
|---|---|
| Article deleted | 404 or 410 |
| Article moved | 301/302 to a different path |
| Moved to archive/pagination | 200 but URL changed |
| Link removed, article intact | 200, link absent |
| Link quietly made nofollow | 200, link present, `rel` changed |
| Link anchor changed | 200, present, different anchor text |
| Page deindexed | live but absent from search index |
| Publisher blocking you | 403, 429, or Cloudflare challenge |

The last row is the important one. **A fetch failure is not a dead link.** Many
publishers block datacentre IPs. Retry with backoff, rotate user agent, and after
repeated failures flag for *manual review* — never auto-refund on it.

### Cadence
Daily for the first week after publication, then weekly for the remainder of the
guarantee window. Most link removals happen early, when a publisher does a
cleanup pass or an editor notices a sponsored post.

### Alerting
- Staff alert on any transition from present to absent.
- Advertiser is **not** notified automatically on first failure. Verify manually
  first — a false alarm about a link they paid for damages trust more than a
  day's delay.
- Publisher-level pattern detection: if one publisher's links keep disappearing,
  that's a supply problem, not a series of incidents. Feed it into the
  reliability score from Phase 4.

### Guarantee enforcement
Require **three consecutive failed checks across at least three days** before an
item is eligible for refund. Single-check refunds will bankrupt you on transient
outages.

When eligible: flag for staff, don't auto-refund. Staff choose between chasing a
replacement placement or issuing the refund. Replacement is usually better for
both sides and preserves the revenue.

## Acceptance tests

1. A failed metrics API call leaves existing `SiteMetric` values intact and the
   site visible in the catalog.
2. Metrics older than the staleness threshold render a staleness indicator.
3. Daily spend cap halts further lookups and alerts, rather than failing silently.
4. A page returning 200 with the link removed is recorded as link-absent.
5. A link changed from dofollow to nofollow is detected and distinguished from removal.
6. A 403 or Cloudflare challenge produces a manual-review flag, not a failure.
7. One failed check does not make an item refund-eligible; three across three
   days does.
8. A redirect chain resolves and records the final URL.
9. Every check writes exactly one `LinkCheck` row, and history is never overwritten.
10. Restoring a removed link clears the alert on the next check.

## Done when

Remove a link from a test page and the system flags it within one cycle, correctly
distinguishes it from a blocked fetch, and does not become refund-eligible until
three checks have failed across three days.

---

## After this, the code is done

What remains before launch is not engineering:

- **Inventory** — sites sourced, priced, vetted
- **Entity and payments** — registration, bank account, provider verified
- **Terms of service and refund policy** — the guarantee above needs to match
  what you contractually promise, word for word
- **The vetting standard** — written down, so it survives your first hire

That last one matters more than it sounds. Your catalog will be a fraction of a
competitor's. The reason someone buys from you instead is that you did the
checking they'd otherwise do themselves — and that only holds if the standard is
explicit rather than living in your head.
