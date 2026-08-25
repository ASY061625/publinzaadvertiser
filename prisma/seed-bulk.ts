/**
 * Bulk seed — generates catalog volume so performance numbers mean something.
 *
 *   npx tsx prisma/seed-bulk.ts 5000
 *
 * Distributions are deliberately realistic, not uniform:
 *   - DR is right-skewed. Most real inventory sits at 30–55, not 70+.
 *   - Traffic is log-normal and only loosely correlated with DR.
 *   - ~12% of sites have NO metrics row at all. This is the case that breaks
 *     sorting and keyset pagination, so it must exist in your test data.
 *   - Price correlates with DR but with wide noise, because publishers price
 *     irrationally and your filters have to cope with that.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const COUNTRIES = [
  "US", "GB", "DE", "IN", "BR", "ES", "FR", "JP", "AU", "CA", "PL", "UA",
  "AE", "NG", "ID", "MX", "IT", "NL", "TR", "KR", "VN", "AR", "ZA", "SE",
  "PH", "SG", "EG", "CO", "CZ", "MY", "TH", "KE", "PK", "BD", "RO", "GR",
];

// Weighted so the catalog looks like a real one: US/GB/IN oversupplied,
// long tail thin. Uniform country distribution hides your worst query plans.
const COUNTRY_WEIGHTS = COUNTRIES.map((_, i) => 1 / Math.pow(i + 1, 0.6));

const LANGS = [
  "en", "de", "es", "pt", "fr", "ja", "pl", "uk", "id", "it", "nl", "tr",
  "ko", "vi", "sv", "ar", "cs", "th", "ms", "el", "ro",
];

const CATEGORIES = [
  "technology", "finance", "crypto", "health", "travel", "business",
  "marketing", "real-estate", "automotive", "fashion", "food", "education",
  "gaming", "sports", "legal", "home-garden", "parenting", "entertainment",
  "science", "energy", "agriculture", "hr", "beauty", "pets", "software",
  "lifestyle", "insurance", "logistics",
];

const SENSITIVE = ["casino", "crypto", "forex", "cbd", "adult", "dating"];

const TLDS = [".com", ".net", ".co", ".io", ".news", ".org", ".biz", ".info"];
const WORDS_A = [
  "urban", "prime", "swift", "north", "clear", "bright", "solid", "vertex",
  "quant", "modern", "daily", "core", "apex", "lumen", "atlas", "nova",
];
const WORDS_B = [
  "wire", "post", "ledger", "digest", "review", "journal", "hub", "pulse",
  "report", "desk", "brief", "signal", "times", "beacon", "index", "scope",
];

/* deterministic PRNG so runs are reproducible */
let seed = 42;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (a: string[]) => a[Math.floor(rnd() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

const weighted = (items: string[], weights: number[]) => {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
};

/** Right-skewed DR: heavy mass in 25–55, thin tail to 85. */
const rollDr = () => {
  const u = rnd();
  return Math.min(88, Math.round(18 + Math.pow(u, 2.2) * 70 + rnd() * 8));
};

/** Log-normal traffic, loosely tied to DR. */
const rollTraffic = (dr: number) => {
  const base = Math.pow(10, 2.6 + (dr / 88) * 2.6);
  return Math.round(base * (0.25 + rnd() * 2.2));
};

async function main() {
  const target = Number(process.argv[2] ?? 5000);
  console.log(`Seeding ${target} sites...`);

  await prisma.categoryOnSite.deleteMany();
  await prisma.siteMetric.deleteMany();
  await prisma.site.deleteMany();
  await prisma.category.deleteMany();
  await prisma.publisher.deleteMany();

  await prisma.category.createMany({
    data: CATEGORIES.map((slug) => ({
      slug,
      name: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    })),
  });
  const cats = await prisma.category.findMany();
  const catIdBySlug = Object.fromEntries(cats.map((c) => [c.slug, c.id]));

  // One publisher per ~4 sites. Real catalogs cluster like this, which is
  // exactly why leaking publisher identity would let anyone map your supply.
  const pubCount = Math.ceil(target / 4);
  await prisma.publisher.createMany({
    data: Array.from({ length: pubCount }, (_, i) => ({
      name: `Publisher ${i + 1}`,
      email: `pub${i + 1}@example.invalid`,
      telegram: `@pub${i + 1}`,
      reliability: int(40, 100),
    })),
  });
  const pubs = await prisma.publisher.findMany({ select: { id: true } });

  const seenDomains = new Set<string>();
  const CHUNK = 500;

  for (let offset = 0; offset < target; offset += CHUNK) {
    const size = Math.min(CHUNK, target - offset);
    const sites: any[] = [];

    for (let i = 0; i < size; i++) {
      let domain: string;
      do {
        domain = `${pick(WORDS_A)}${pick(WORDS_B)}${int(1, 9999)}${pick(TLDS)}`;
      } while (seenDomains.has(domain));
      seenDomains.add(domain);

      const dr = rollDr();
      const cost = Math.round((25 + Math.pow(dr / 10, 2.4) * 4) * (0.6 + rnd() * 1.5));
      const margin = 1.35 + rnd() * 0.5;

      // Restricted-topic acceptance skews toward lower-quality inventory.
      const sens: string[] = [];
      const openness = rnd() * (1 - dr / 140);
      SENSITIVE.forEach((s) => {
        if (rnd() < openness * 0.9) sens.push(s);
      });

      sites.push({
        domain,
        channelType: rnd() < 0.08 ? "TELEGRAM" : "WEBSITE",
        country: weighted(COUNTRIES, COUNTRY_WEIGHTS),
        language: pick(LANGS),
        costCents: cost * 100,
        priceCents: Math.round(cost * margin) * 100,
        writingCents: int(25, 90) * 100,
        turnaroundDays: int(2, 14),
        linkType: rnd() < 0.88 ? "DOFOLLOW" : rnd() < 0.6 ? "NOFOLLOW" : "SPONSORED",
        maxLinks: int(1, 3),
        minWords: [500, 700, 800, 1000, 1200][int(0, 4)],
        permanent: rnd() < 0.9,
        guaranteeDays: rnd() < 0.75 ? 90 : 365,
        acceptsSensitive: sens,
        isActive: rnd() < 0.94,       // some inactive rows must exist
        isExclusive: rnd() < 0.15,
        publisherId: pubs[int(0, pubs.length - 1)].id,
        _dr: dr,                       // stripped before insert
      });
    }

    const drByDomain = new Map(sites.map((s) => [s.domain, s._dr]));
    sites.forEach((s) => delete s._dr);

    await prisma.site.createMany({ data: sites, skipDuplicates: true });

    const created = await prisma.site.findMany({
      where: { domain: { in: sites.map((s) => s.domain) } },
      select: { id: true, domain: true },
    });

    const catLinks: any[] = [];
    const metrics: any[] = [];

    for (const s of created) {
      const n = int(1, 3);
      const chosen = new Set<string>();
      while (chosen.size < n) chosen.add(pick(CATEGORIES));
      chosen.forEach((slug) =>
        catLinks.push({ siteId: s.id, categoryId: catIdBySlug[slug] })
      );

      // ~12% have no metrics row. Do not remove this.
      if (rnd() < 0.88) {
        const dr = drByDomain.get(s.domain)!;
        const traffic = rollTraffic(dr);
        const gaVerified = rnd() < 0.3;
        metrics.push({
          siteId: s.id,
          domainRating: dr,
          urlRating: Math.max(1, dr - int(2, 15)),
          organicTraffic: traffic,
          refDomains: Math.round(Math.pow(dr, 2.1) * (0.5 + rnd())),
          spamScore: Math.min(17, Math.round(Math.pow(rnd(), 2) * 20)),
          topCountry: pick(COUNTRIES),
          topCountryShare: 0.25 + rnd() * 0.7,
          gaVerified,
          gscVerified: gaVerified && rnd() < 0.7,
          // Staleness varies — your UI needs to surface this.
          fetchedAt: new Date(Date.now() - int(0, 90) * 86400000),
        });
      }
    }

    await prisma.categoryOnSite.createMany({ data: catLinks, skipDuplicates: true });
    await prisma.siteMetric.createMany({ data: metrics, skipDuplicates: true });

    process.stdout.write(`\r  ${Math.min(offset + CHUNK, target)}/${target}`);
  }

  console.log("\nRunning ANALYZE so the planner has fresh statistics...");
  await prisma.$executeRawUnsafe("ANALYZE");

  const [sites, withMetrics] = await Promise.all([
    prisma.site.count(),
    prisma.siteMetric.count(),
  ]);
  console.log(`Done. ${sites} sites, ${withMetrics} with metrics, ${sites - withMetrics} without.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
