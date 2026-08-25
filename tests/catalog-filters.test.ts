import { describe, expect, it, vi } from "vitest";
import { GET as getSites } from "@/app/api/sites/route";

/*
 * These call the route handlers in-process, so there is no session to gate on.
 * The catalog gate is covered in tests/gated-access.spec.ts; what matters here
 * is what the route serialises, so the gate is stubbed rather than satisfied.
 */
vi.mock("@/lib/data/session", () => ({
  requireApprovedApi: async () => ({
    id: "catalog-test-actor",
    email: "catalog-test@example.test",
    role: "ADMIN" as const,
    approved: true,
  }),
}));


const BASE = "http://localhost/api/sites";

type Site = {
  id: string;
  domain: string;
  country: string;
  language: string;
  priceCents: number;
  turnaroundDays: number;
  linkType: string;
  acceptsSensitive: string[];
  categories: { slug: string }[];
  metrics: { domainRating: number | null; organicTraffic: number | null; gaVerified: boolean } | null;
};

async function catalog(qs: string) {
  const res = await getSites(new Request(`${BASE}?${qs}`));
  return { status: res.status, body: (await res.json()) as { sites: Site[]; nextCursor: string | null; total: number } };
}

describe("filtering happens in SQL and is respected", () => {
  it("restricts by country", async () => {
    const { body } = await catalog("country=US,GB&limit=100");
    expect(body.sites.length).toBeGreaterThan(0);
    expect(body.sites.every((s) => ["US", "GB"].includes(s.country))).toBe(true);
  });

  it("restricts by language", async () => {
    const { body } = await catalog("language=de&limit=100");
    expect(body.sites.every((s) => s.language === "de")).toBe(true);
  });

  it("applies the DR band inclusively", async () => {
    const { body } = await catalog("drMin=50&drMax=60&limit=100");
    expect(body.sites.length).toBeGreaterThan(0);
    expect(body.sites.every((s) => s.metrics!.domainRating! >= 50 && s.metrics!.domainRating! <= 60)).toBe(true);
  });

  it("applies the traffic floor", async () => {
    const { body } = await catalog("trafficMin=100000&limit=100");
    expect(body.sites.every((s) => s.metrics!.organicTraffic! >= 100000)).toBe(true);
  });

  it("applies the price window", async () => {
    const { body } = await catalog("priceMinCents=10000&priceMaxCents=30000&limit=100");
    expect(body.sites.length).toBeGreaterThan(0);
    expect(body.sites.every((s) => s.priceCents >= 10000 && s.priceCents <= 30000)).toBe(true);
  });

  it("returns only dofollow-bearing link types", async () => {
    const { body } = await catalog("dofollow=true&limit=100");
    expect(body.sites.every((s) => ["DOFOLLOW", "MIXED"].includes(s.linkType))).toBe(true);
  });

  it("returns only analytics-verified sites", async () => {
    const { body } = await catalog("gaVerified=true&limit=100");
    expect(body.sites.every((s) => s.metrics!.gaVerified)).toBe(true);
  });

  it("caps turnaround", async () => {
    const { body } = await catalog("maxTurnaroundDays=5&limit=100");
    expect(body.sites.every((s) => s.turnaroundDays <= 5)).toBe(true);
  });

  it("treats multiple topics as OR", async () => {
    const { body } = await catalog("topic=finance,gaming&limit=100");
    expect(body.sites.length).toBeGreaterThan(0);
    expect(
      body.sites.every((s) => s.categories.some((c) => ["finance", "gaming"].includes(c.slug)))
    ).toBe(true);
  });

  it("treats multiple restricted topics as AND", async () => {
    const { body } = await catalog("accepts=crypto,forex&limit=100");
    expect(body.sites.length).toBeGreaterThan(0);
    expect(
      body.sites.every((s) => s.acceptsSensitive.includes("crypto") && s.acceptsSensitive.includes("forex"))
    ).toBe(true);
  });

  it("matches the domain search case-insensitively", async () => {
    // The term is taken from a real row so this holds under any seed.
    const seedRow = (await catalog("limit=1")).body.sites[0];
    const term = seedRow.domain.replace(/^https?:\/\//, "").slice(0, 5);

    const { body } = await catalog(`q=${encodeURIComponent(term.toUpperCase())}&limit=100`);
    expect(body.sites.length).toBeGreaterThan(0);
    expect(body.sites.every((s) => s.domain.toLowerCase().includes(term.toLowerCase()))).toBe(true);
  });

  it("intersects filters rather than unioning them", async () => {
    const { body } = await catalog("country=US&dofollow=true&drMin=60&limit=100");
    expect(
      body.sites.every(
        (s) => s.country === "US" && ["DOFOLLOW", "MIXED"].includes(s.linkType) && s.metrics!.domainRating! >= 60
      )
    ).toBe(true);
  });
});

describe("sorting", () => {
  it("sorts by DR descending", async () => {
    const { body } = await catalog("sort=dr&limit=100");

    // Coalesced the same way the query orders, so a site with no metrics row
    // sorts last instead of turning the comparison into NaN.
    const drs = body.sites.map((s) => s.metrics?.domainRating ?? -1);
    expect(drs.length).toBeGreaterThan(0);
    expect([...drs].sort((a, b) => b - a)).toEqual(drs);
  });

  it("sorts by price ascending and descending", async () => {
    const asc = (await catalog("sort=price_asc&limit=100")).body.sites.map((s) => s.priceCents);
    expect([...asc].sort((a, b) => a - b)).toEqual(asc);

    const desc = (await catalog("sort=price_desc&limit=100")).body.sites.map((s) => s.priceCents);
    expect([...desc].sort((a, b) => b - a)).toEqual(desc);
  });

  it("sorts by fastest turnaround", async () => {
    const days = (await catalog("sort=turnaround&limit=100")).body.sites.map((s) => s.turnaroundDays);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });
});

describe("keyset pagination", () => {
  it("walks the whole filtered set with no gaps or repeats", async () => {
    // Page size follows the filtered row count, so the walk spans several pages
    // regardless of how many rows the current seed produced.
    const sizing = await catalog("sort=dr&drMin=40&limit=1");
    const limit = Math.max(1, Math.floor(sizing.body.total / 4));

    const filter = `sort=dr&drMin=40&limit=${limit}`;
    const first = await catalog(filter);
    const expected = first.body.total;

    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;

    do {
      const qs = `${filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const { body } = await catalog(qs);
      for (const s of body.sites) {
        expect(seen.has(s.id)).toBe(false);
        seen.add(s.id);
      }
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 200);

    expect(seen.size).toBe(expected);
    expect(pages).toBeGreaterThan(1);
  });

  it("keeps the sort order across the page boundary", async () => {
    const first = await catalog("sort=price_asc&limit=25");
    const second = await catalog(`sort=price_asc&limit=25&cursor=${encodeURIComponent(first.body.nextCursor!)}`);

    const lastOfFirst = first.body.sites.at(-1)!.priceCents;
    expect(second.body.sites[0].priceCents).toBeGreaterThanOrEqual(lastOfFirst);
    expect(second.body.sites.map((s) => s.id)).not.toContain(first.body.sites.at(-1)!.id);
  });

  it("rejects a cursor issued for a different sort", async () => {
    const { body } = await catalog("sort=dr&limit=10");
    const { status } = await catalog(`sort=price_asc&limit=10&cursor=${encodeURIComponent(body.nextCursor!)}`);
    expect(status).toBe(400);
  });
});

describe("input validation", () => {
  it.each([
    ["drMin=200", "out-of-range DR"],
    ["drMin=abc", "non-numeric DR"],
    ["drMin=80&drMax=20", "inverted DR band"],
    ["priceMinCents=900&priceMaxCents=100", "inverted price window"],
    ["sort=cheapest", "unknown sort"],
    ["accepts=weapons", "unknown restricted topic"],
    ["limit=5000", "oversized limit"],
    ["cursor=not-a-real-cursor", "malformed cursor"],
  ])("rejects %j (%s)", async (qs) => {
    const { status } = await catalog(qs);
    expect(status).toBe(400);
  });
});
