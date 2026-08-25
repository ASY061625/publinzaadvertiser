# Supply playbook — getting your first 60 sites

The platform is built. This is the part that decides whether it becomes a business.

---

## 1. The vetting standard

Write this down and hold to it. Your catalog will be a fraction of a
competitor's, so the only reason anyone buys from you is that you did the
checking they'd otherwise do themselves. That advantage evaporates the moment you
let a weak site in because you needed inventory.

### Minimum bar

| Check | Threshold |
|---|---|
| Domain rating | 30+ |
| Monthly organic traffic | 1,000+ |
| Traffic trend, 12 months | Flat or rising |
| Traffic geography | Matches the country you're listing it under |
| Outbound dofollow links per article | 3 or fewer |
| Spam score | Under 8 |
| Real bylines and contact page | Yes |
| Old sponsored posts still live | Yes — check posts 18+ months old |

### Automatic rejections

**Traffic collapse.** A snapshot tells you nothing. Look at the 12-month graph. A
60%+ drop means an algorithmic penalty, and a link from a penalised site is worse
than no link.

**Traffic that isn't real.** High traffic with near-zero traffic value means the
site ranks for junk terms nobody searches commercially. Compare the two numbers
in any SEO tool; if they're wildly out of proportion, walk.

**The link farm tell.** Look at the last twenty published posts. If they span
crypto, dentistry, casinos, and CBD with no editorial thread, it exists purely to
sell links. Google knows this too.

**A "sponsored posts" archive page** with hundreds of entries. The site has
already declared itself.

**PBN fingerprints.** Sites in a private network share tells: identical page
templates across different domains, the same Google Analytics or AdSense ID, the
same registrar and creation date, near-identical About pages with different names.
If you find one, check the others from the same seller.

**Inflated authority.** High DR with few referring domains, most from the same
handful of sources, means the number was manufactured. DR is a tool's estimate,
not a fact.

**Deleted history.** If sponsored posts from two years ago are gone, yours will be
too. This one check predicts more refunds than any other.

### Time budget

About 10 minutes per site once you've done thirty. Don't shortcut it — every site
that slips through costs you a refund and a customer.

---

## 2. Where to find sites

**Competitor backlink mining.** Take five sites already ranking in your target
niches and pull their backlink profiles. Every publication that accepted a guest
post from them will consider one from you. This is the highest-quality source and
almost nobody does it systematically.

**Search operators.** In each niche:
```
"write for us" + [niche]
"guest post guidelines" + [niche]
"contribute" + [niche] -inurl:tag
"become a contributor" + [niche]
```
Lower quality than backlink mining — these sites are already saturated with
requests — but fast to gather.

**Existing marketplaces, as a stopgap.** Buy placements from established
platforms and resell them at a thinner margin. Nearly zero margin and no moat, but
it lets you show a working catalog to your first customers while real
relationships build. Use it as scaffolding, not foundation.

**Telegram and Facebook link-building groups.** High volume, low quality, worth
mining specifically for publishers who own several sites at once.

**LinkedIn, direct to editors.** Slowest, highest quality, best pricing. Editors
of genuine trade publications rarely appear on link marketplaces at all, which is
exactly why they're valuable to you.

---

## 3. Outreach

Short, specific, no flattery. Editors get dozens of these daily and can smell a
template instantly.

**Subject:** Paid contribution — [their site]

```
Hi [name],

I run [company], a content placement agency working with clients in
[2–3 niches].

I'd like to place occasional sponsored articles on [site]. Original,
written to your guidelines, no thin content.

Could you tell me:
  - Your rate per article
  - Turnaround from submission
  - Whether links are dofollow
  - Any topics you don't accept

Happy to start with one piece so you can see the quality.

[Name]
[Company] · [website] · [phone]
```

**Follow up once, after five days.** Two lines, no guilt-tripping. Then stop.

Expect roughly: 100 emails → 25 replies → 12 that pass vetting → 8 that agree
terms. So 60 sites is around eight weeks of steady outreach. Plan for that, and
send in batches of 25 so you can actually handle the replies.

---

## 4. What to agree

Get these in writing, even if it's just email:

- **Price per placement**, and a bulk rate at 5 and 10 articles
- **Turnaround** from submission to publication
- **Permanent placement** — no removal, no rewriting after publication
- **Link attributes** — ask what they actually do rather than requesting dofollow;
  their honest answer tells you a lot
- **Whether they accept your writers' content** or insist on their own
- **Restricted topics** they won't take
- **Payment terms** — push for payment after publication. Your customer pays you
  upfront and you pay the publisher on delivery, which means the business funds
  its own growth instead of your savings doing it

### Pricing

Mark up 40–60% over publisher cost. Below 30% and you can't absorb refunds and
replacements; above 70% and buyers who check other marketplaces will notice.

Record cost and price separately from day one — the schema already does this.

---

## 5. Loading the catalog

Track everything in one spreadsheet with the columns the Phase 4 importer
expects:

```
domain, country, language, categories, cost, price, writing_price,
turnaround_days, link_type, max_links, min_words, guarantee_days,
accepts_sensitive, publisher_name, publisher_email, publisher_telegram, notes
```

Add a `vetted_on` and `vetted_by` column for yourself. When a placement goes
wrong six months from now, you'll want to know who cleared the site and when.

Import in batches of 20 through the dry-run preview. Never paste into the
database directly — you built the importer specifically so nobody has to.

---

## 6. Before you take real money

- **Terms of service and refund policy**, matching the guarantee the link checker
  actually enforces. If Phase 6 requires three failed checks across three days
  before refund eligibility, the policy must say so in those words. A mismatch
  between what the code does and what the contract promises is the one that ends
  in a chargeback you lose.
- **Privacy policy**, since you're holding customer data across jurisdictions.
- **Invoice compliance** — GST or VAT fields, correct sequential numbering.
- **A written vetting standard** — section 1 of this document, in your own words,
  so it survives your first hire.
- **Test the full flow with your own money.** Buy a placement on your own site
  through your own platform. You will find something broken.

---

## 7. First customers

Don't launch to the public. Find five advertisers you can talk to directly —
agencies you know, people in SEO communities, past clients. Sell to them
personally, at a discount, in exchange for blunt feedback.

Five paying customers who tell you the truth are worth more than five hundred
signups who quietly leave. And with a catalog this size, personal service is the
product.

---

## Realistic timeline

| Track | Duration | Blocks |
|---|---|---|
| Company registration + bank account | 2–4 weeks | Everything |
| Payment provider verification | 2–6 weeks | Registration |
| Site sourcing to 60 | 8–12 weeks | Nothing — start now |
| Terms and policies | 1 week | Nothing |

Sourcing is the longest track and the only one nothing else blocks. It should
have started before the code did. Start it today.
