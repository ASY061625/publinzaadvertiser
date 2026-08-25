/**
 * Regenerates catalog-snapshot.json from the app database.
 *
 *   npx tsx scripts/export-marketing-aggregates.ts
 *
 * Run this after the catalog changes and redeploy the marketing site. The
 * marketing site never queries the app database at request time — it is a
 * separate deploy, and a marketing page must not be able to take the platform
 * down or leak anything that is not already public.
 *
 * ── Aggregates only ────────────────────────────────────────────────────────
 *
 * This used to export one masked row per site, which fed a public catalog
 * preview. The catalog is now gated: nothing about an individual publication is
 * visible until an account exists and staff have approved it.
 *
 * So the export boundary is the enforcement point. Nothing per-site is written
 * at all — not masked domains, not individual prices, not metrics. What comes
 * out is counts and ranges, which reveal nothing a competitor can act on while
 * still letting a buyer judge whether signing up is worth it:
 *
 *   "14 finance publications in Germany. DR 40–70. Placements from $180."
 *
 * A leak is impossible rather than unlikely, because the data never leaves the
 * database in the first place.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Only published where the group is big enough that no single site is identifiable. */
const MIN_GROUP = 5;

async function main() {
  // Lives in the app project because the app owns the data and has Prisma; the
  // marketing site is a separate deploy that carries no database client at all.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  const sites = await prisma.site.findMany({
    where: { isActive: true },
    select: {
      country: true,
      priceCents: true,
      turnaroundDays: true,
      categories: { select: { category: { select: { slug: true, name: true } } } },
      metrics: { select: { domainRating: true, organicTraffic: true } },
    },
  });

  const prices = sites.map((s) => s.priceCents).filter((p) => p > 0);
  const drs = sites
    .map((s) => s.metrics?.domainRating)
    .filter((d): d is number => typeof d === "number");
  const traffic = sites
    .map((s) => s.metrics?.organicTraffic)
    .filter((t): t is number => typeof t === "number");

  const median = (values: number[]) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  const range = (values: number[]) =>
    values.length > 0 ? { min: Math.min(...values), max: Math.max(...values) } : null;

  /** Counts per group, suppressed below MIN_GROUP so a group cannot identify a site. */
  function groupCounts(pairs: [string, string][]) {
    const counts = new Map<string, { label: string; count: number }>();
    for (const [slug, label] of pairs) {
      const entry = counts.get(slug) ?? { label, count: 0 };
      entry.count += 1;
      counts.set(slug, entry);
    }
    return [...counts.entries()]
      .filter(([, v]) => v.count >= MIN_GROUP)
      .map(([slug, v]) => ({ slug, label: v.label, count: v.count }))
      .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),

    siteCount: sites.length,
    countryCount: new Set(sites.map((s) => s.country)).size,
    categoryCount: new Set(
      sites.flatMap((s) => s.categories.map((c) => c.category.slug))
    ).size,

    // Ranges, not per-site values.
    priceMinCents: range(prices)?.min ?? 0,
    priceMaxCents: range(prices)?.max ?? 0,
    priceMedianCents: median(prices),
    domainRatingRange: range(drs),
    trafficRange: range(traffic),
    turnaroundRange: range(sites.map((s) => s.turnaroundDays)),

    countries: groupCounts(sites.map((s) => [s.country, s.country] as [string, string])),
    niches: groupCounts(
      sites.flatMap((s) =>
        s.categories.map((c) => [c.category.slug, c.category.name] as [string, string])
      )
    ),
  };

  // Written straight into the marketing project, which reads it at build time.
  const out =
    process.env.MARKETING_SNAPSHOT_PATH ??
    join(process.cwd(), "..", "outpost-marketing", "catalog-snapshot.json");
  writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  console.log(
    `Wrote aggregates for ${snapshot.siteCount} sites ` +
      `(${snapshot.countries.length} countries, ${snapshot.niches.length} niches) to ${out}`
  );
  console.log("No per-site row was exported.");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
