# Marketing site — brief

Apex domain (`yourdomain.com`) sells. App lives on `app.yourdomain.com`.
Separate Next.js project, separate deploy — a marketing copy change should never
risk the platform, and the marketing site needs static generation the app doesn't.

## The strategic point

You sell SEO outcomes. Your own site is the demo. If it loads slowly, has thin
content, and ranks for nothing, no informed buyer will trust you with their
backlink profile. This site has to be genuinely well built, not just look nice.

Target: Lighthouse 95+ across the board, static or ISR everywhere, no
client-side rendering for anything a crawler needs to see.

## Sitemap

### Core
- `/` — Home
- `/catalog` — **Public catalog preview.** The most important page on the site.
- `/how-it-works`
- `/pricing`
- `/guarantee` — link monitoring and refund policy in plain language
- `/vetting` — your quality standard, published

### Trust
- `/about` — real names, real faces, real address. This industry is full of
  anonymous operators; not being one is a differentiator.
- `/case-studies` — thin at launch, one is enough
- `/contact`

### Conversion
- `/for/agencies`
- `/for/saas`
- `/for/in-house-marketing`

Same offer, different framing. Agencies care about client reporting and margin;
SaaS cares about domain authority; in-house cares about approvals and invoicing.

### SEO
- `/blog` — the long game, see below
- `/glossary/[term]` — DR, anchor text, dofollow, PBN, etc. Cheap, ranks, and
  demonstrates competence to buyers who are learning.

### Legal
- `/terms`, `/privacy`, `/refund-policy`

Refund policy must match what the Phase 6 link checker actually enforces, word
for word. Three failed checks across three days. A gap between contract and code
is the one that loses chargebacks.

## The catalog preview page

This is both your best conversion page and your biggest SEO asset. Collaborator
does this well and it's worth studying.

**Public, no login.** Show real sites with real metrics and real prices. The
instinct to hide prices behind a signup is wrong — buyers comparison-shop, and a
gate means they compare someone else.

**What to withhold:** full domain names on the free view. Show `techrada***.com`
with the category, country, DR, traffic, and price visible. Enough to evaluate,
not enough to skip you and email the publisher directly. Reveal on signup.

**Programmatic pages.** Generate one per meaningful filter combination:
- `/catalog/country/germany`
- `/catalog/niche/finance`
- `/catalog/niche/finance/country/germany`

Only generate a page where you have 5+ sites, otherwise you're publishing thin
pages that will hurt you. Each needs 150+ words of genuine intro copy about
placement in that market — not spun boilerplate.

This is how a small catalog outranks a large one: they have more sites, you have
better pages.

## Positioning

Do not compete on catalog size. You will lose, and buyers will check.

Lead with the vetting standard. Publish it. Say plainly that you reject most
sites you review and explain what gets rejected — collapsed traffic, deleted
sponsored archives, PBN fingerprints. Nobody else in this market publishes their
rejection criteria, and it reframes a small catalog as a curated one.

Second pillar: the guarantee. Every link monitored for the full guarantee window,
with the actual mechanism explained.

Third: honest pricing. Cost per placement shown up front, no subscription, no
minimum.

### Copy rules
- No "boost your rankings" or "skyrocket your traffic". Your buyers are
  professionals who've read that a thousand times.
- No fake urgency, no fake counters, no invented testimonials.
- Never promise ranking outcomes. Promise placements, on vetted sites, that stay live.
- Say "we have 60 sites and here's why each one is there" rather than implying more.

## Blog

Not optional — it's how you rank for the terms your buyers search before they're
ready to buy.

First ten posts should be things only an operator knows:
- How to check whether a guest post site is a PBN
- What DR actually measures, and what it misses
- Why sponsored post archives predict link removal
- Guest post pricing by country, with real numbers
- What to ask a publisher before paying

Write from your actual vetting work. Generic SEO content ranks for nothing and
signals that you're not a practitioner.

## Technical

- Next.js, static generation, deployed separately from the app
- Schema.org: Organization, Product for catalog entries, FAQPage, BreadcrumbList
- `sitemap.xml` including all programmatic catalog pages
- OG images per page
- Analytics: Plausible or GA4, plus Search Console from day one
- Shared design tokens with the app so the transition to `app.` isn't jarring
- One primary CTA everywhere: "Browse the catalog" → `/catalog` → signup

## Build order

1. Home, catalog preview, how it works, pricing, guarantee — enough to sell
2. Legal pages — required before taking money
3. Vetting, about, contact — trust layer
4. Programmatic catalog pages — after you have 30+ sites, not before
5. Segment pages and blog — ongoing
