// Measures the Phase 1 exit gate: catalog filtering must stay under 150ms.
// Run against a seeded database: npx tsx scripts/bench-catalog.ts
import { parseFilters } from "../src/lib/catalog/filters";
import { countCatalog, queryCatalog } from "../src/lib/catalog/query";
import type { Actor } from "../src/lib/data/actor";

// The catalog gate takes an approved actor. This benchmark runs offline against
// the database, so it declares one here rather than app code exposing a bypass
// that a route could reach for.
const BENCH_ACTOR: Actor = {
  id: "bench",
  email: "bench@local",
  role: "ADMIN",
  approved: true,
};
import { prisma } from "../src/lib/db";

const CASES: [string, string][] = [
  ["unfiltered, sort by DR", "sort=dr&limit=50"],
  ["unfiltered, sort by price asc", "sort=price_asc&limit=50"],
  ["unfiltered, sort by traffic", "sort=traffic&limit=50"],
  ["topic only", "topic=finance&sort=dr&limit=50"],
  ["multi-topic", "topic=finance,crypto,business&sort=dr&limit=50"],
  ["country + language", "country=US,GB,CA&language=en&sort=dr&limit=50"],
  ["DR band + traffic floor", "drMin=50&drMax=80&trafficMin=50000&sort=dr&limit=50"],
  ["price window + dofollow", "priceMinCents=10000&priceMaxCents=60000&dofollow=true&sort=price_asc&limit=50"],
  ["GA verified + turnaround", "gaVerified=true&maxTurnaroundDays=7&sort=turnaround&limit=50"],
  ["restricted topics", "accepts=crypto,forex&sort=dr&limit=50"],
  ["domain search", "q=tech&sort=dr&limit=50"],
  [
    "everything at once",
    "topic=finance,crypto,technology&country=US,GB,DE,IN&language=en,de&drMin=40&drMax=85" +
      "&trafficMin=20000&priceMinCents=5000&priceMaxCents=80000&dofollow=true&gaVerified=true" +
      "&maxTurnaroundDays=10&accepts=crypto&sort=dr&limit=50",
  ],
];

const RUNS = 12;

async function timed(fn: () => Promise<unknown>) {
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    await fn();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  return {
    median: samples[Math.floor(samples.length / 2)],
    p95: samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))],
  };
}

async function main() {
  const total = await prisma.site.count();
  console.log(`Catalog rows: ${total}\n`);
  console.log("case".padEnd(34) + "rows".padStart(7) + "median".padStart(10) + "p95".padStart(9));
  console.log("-".repeat(60));

  let worst = 0;
  for (const [label, qs] of CASES) {
    const filters = parseFilters(new URLSearchParams(qs));
    // Warm the plan cache so we measure steady state, not first-call compile.
    await Promise.all([queryCatalog(BENCH_ACTOR, filters), countCatalog(BENCH_ACTOR, filters)]);

    const matched = await countCatalog(BENCH_ACTOR, filters);
    const t = await timed(() => Promise.all([queryCatalog(BENCH_ACTOR, filters), countCatalog(BENCH_ACTOR, filters)]));
    worst = Math.max(worst, t.p95);

    console.log(
      label.padEnd(34) +
        String(matched).padStart(7) +
        `${t.median.toFixed(1)}ms`.padStart(10) +
        `${t.p95.toFixed(1)}ms`.padStart(9)
    );
  }

  console.log("-".repeat(60));
  console.log(`worst p95: ${worst.toFixed(1)}ms  (gate: 150ms) — ${worst < 150 ? "PASS" : "FAIL"}`);

  // Keyset pagination must walk the whole result set with no gaps or repeats.
  const walkFilters = parseFilters(new URLSearchParams("sort=dr&limit=50&drMin=30"));
  const expected = await countCatalog(BENCH_ACTOR, walkFilters);
  const seen = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  const pageTimes: number[] = [];
  do {
    const t = performance.now();
    const res: Awaited<ReturnType<typeof queryCatalog>> = await queryCatalog(BENCH_ACTOR, {
      ...walkFilters,
      cursor,
    });
    pageTimes.push(performance.now() - t);
    for (const s of res.sites) {
      if (seen.has(s.id)) throw new Error(`duplicate row across pages: ${s.id}`);
      seen.add(s.id);
    }
    cursor = res.nextCursor;
    pages++;
  } while (cursor && pages < 5000);

  const deepest = Math.max(...pageTimes);
  console.log(
    `\nkeyset walk: ${pages} pages, ${seen.size}/${expected} unique rows, ` +
      `slowest page ${deepest.toFixed(1)}ms — ${seen.size === expected ? "PASS" : "FAIL"}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
