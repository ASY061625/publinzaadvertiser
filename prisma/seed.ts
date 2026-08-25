import { PrismaClient, type ChannelType, type LinkType } from "@prisma/client";
import { CATEGORIES, COUNTRY_LANGUAGE, CURATED, SENSITIVE_TOPICS, type SeedSite } from "./seed-data";

const prisma = new PrismaClient();

// CLAUDE.md asks for ~60 curated sites, but the Phase 1 exit gate is a latency
// number at 5,000 rows. `--count=N` pads the curated set with generated filler
// so that gate is measurable without shipping 5,000 fake domains by default.
const countArg = process.argv.find((a) => a.startsWith("--count="));
const TARGET = countArg ? Number(countArg.slice("--count=".length)) : CURATED.length;

// Deterministic PRNG so a given --count always produces the same catalog.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260820);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const COUNTRIES = Object.keys(COUNTRY_LANGUAGE);
const CAT_SLUGS = CATEGORIES.map((c) => c.slug);

const FILLER_STEMS = [
  "daily", "wire", "post", "journal", "review", "digest", "insider", "report",
  "beat", "monitor", "gazette", "tribune", "ledger", "pulse", "signal", "brief",
];
const FILLER_TOPICS = [
  "market", "tech", "health", "travel", "money", "living", "sport", "auto",
  "green", "urban", "craft", "media", "startup", "family", "career", "home",
];

function generate(index: number): SeedSite {
  const country = pick(COUNTRIES);
  const language = COUNTRY_LANGUAGE[country];
  const dr = between(8, 82);

  // Traffic correlates with DR, with wide scatter — mirrors real inventory.
  const trafficBase = Math.pow(10, 2.4 + (dr / 100) * 3.4);
  const traffic = Math.round(trafficBase * (0.35 + rand() * 1.9));

  // Price tracks DR far more than traffic does, and cheap markets stay cheap.
  const cheapMarket = ["IN", "NG", "KE", "PH", "VN", "ID", "UA", "EG", "TR", "BR", "RO", "TH", "MY"].includes(country);
  const priceBase = Math.pow(dr, 1.62) / (cheapMarket ? 9.5 : 3.6);
  const price = Math.max(35, Math.round(priceBase * (0.7 + rand() * 0.85)));
  const margin = 0.34 + rand() * 0.16;
  const cost = Math.max(15, Math.round(price * (1 - margin)));

  const catCount = rand() < 0.45 ? 1 : rand() < 0.85 ? 2 : 3;
  const cats: string[] = [];
  while (cats.length < catCount) {
    const c = pick(CAT_SLUGS);
    if (!cats.includes(c)) cats.push(c);
  }

  const sens: string[] = [];
  if (rand() < 0.3) {
    const n = between(1, 3);
    while (sens.length < n) {
      const s = pick(SENSITIVE_TOPICS);
      if (!sens.includes(s)) sens.push(s);
    }
  }

  const spam = sens.length > 0 ? between(3, 12) : between(0, 6);
  const ga = rand() < 0.55;

  return {
    domain: `${pick(FILLER_TOPICS)}${pick(FILLER_STEMS)}${index}.${country.toLowerCase() === "us" ? "com" : country.toLowerCase()}`,
    country,
    language,
    cats,
    dr,
    traffic,
    refDomains: Math.round(traffic / between(20, 90)) + between(20, 400),
    spam,
    price,
    cost,
    writing: Math.max(20, Math.round(price * (0.12 + rand() * 0.12))),
    dofollow: rand() < 0.82,
    days: between(2, 21),
    ga,
    gsc: ga ? rand() < 0.7 : rand() < 0.2,
    sens,
    topCountryShare: 0.35 + rand() * 0.6,
  };
}

const PUBLISHERS = [
  { name: "Meridian Media Group", email: "placements@meridian-media.example", telegram: "@meridian_placements" },
  { name: "Sandbar Digital", email: "hello@sandbardigital.example", telegram: "@sandbar_ops" },
  { name: "Northlight Publishing", email: "editorial@northlight.example", telegram: null },
  { name: "Kestrel Content Partners", email: "partners@kestrelcp.example", telegram: "@kestrel_cp" },
  { name: "Blue Harbour Network", email: null, telegram: "@blueharbour_desk" },
  { name: "Cordillera Press", email: "guest@cordillerapress.example", telegram: null },
  { name: "Vantage Syndicate", email: "syndication@vantage.example", telegram: "@vantage_sales" },
  { name: "Foxglove Media", email: "team@foxglovemedia.example", telegram: "@foxglove" },
];

async function main() {
  console.log(`Seeding catalog — target ${TARGET} sites.`);

  // Catalog tables only. Wiping is safe here because Phase 1 has no orders yet;
  // once OrderItem rows exist this must become an upsert-only path.
  await prisma.linkCheck.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.siteMetric.deleteMany();
  await prisma.categoryOnSite.deleteMany();
  await prisma.site.deleteMany();
  await prisma.category.deleteMany();
  await prisma.publisher.deleteMany();

  await prisma.category.createMany({ data: CATEGORIES });
  const categories = await prisma.category.findMany();
  const catIdBySlug = new Map(categories.map((c) => [c.slug, c.id]));

  await prisma.publisher.createMany({ data: PUBLISHERS });
  const publishers = await prisma.publisher.findMany();

  const sites: SeedSite[] = [...CURATED];
  const seen = new Set(sites.map((s) => s.domain));
  for (let i = sites.length; i < TARGET; i++) {
    let s = generate(i);
    while (seen.has(s.domain)) s = generate(i + Math.floor(rand() * 1e6));
    seen.add(s.domain);
    sites.push(s);
  }
  if (sites.length > TARGET) sites.length = TARGET;

  const siteRows = sites.map((s, i) => ({
    id: `site_${String(i).padStart(6, "0")}`,
    domain: s.domain,
    channelType: (s.channel ?? "WEBSITE") as ChannelType,
    country: s.country,
    language: s.language,
    description: null,
    costCents: s.cost * 100,
    priceCents: s.price * 100,
    writingCents: s.writing * 100,
    turnaroundDays: s.days,
    linkType: (s.dofollow ? "DOFOLLOW" : "NOFOLLOW") as LinkType,
    maxLinks: s.dr >= 60 ? 1 : 2,
    minWords: s.dr >= 65 ? 900 : 700,
    permanent: true,
    guaranteeDays: s.dr >= 60 ? 180 : 90,
    acceptsSensitive: s.sens,
    isActive: true,
    isExclusive: i % 37 === 0,
    publisherId: publishers[i % publishers.length].id,
  }));

  await prisma.site.createMany({ data: siteRows });

  await prisma.siteMetric.createMany({
    data: sites.map((s, i) => ({
      siteId: siteRows[i].id,
      domainRating: s.dr,
      urlRating: Math.max(0, s.dr - between(4, 16)),
      organicTraffic: s.traffic,
      refDomains: s.refDomains,
      spamScore: s.spam,
      topCountry: s.country,
      topCountryShare: s.topCountryShare ?? 0.55 + rand() * 0.4,
      gaVerified: s.ga,
      gscVerified: s.gsc,
    })),
  });

  await prisma.categoryOnSite.createMany({
    data: sites.flatMap((s, i) =>
      s.cats
        .filter((slug) => catIdBySlug.has(slug))
        .map((slug) => ({ siteId: siteRows[i].id, categoryId: catIdBySlug.get(slug)! }))
    ),
    skipDuplicates: true,
  });

  console.log(
    `Done — ${siteRows.length} sites, ${categories.length} categories, ${publishers.length} publishers.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
