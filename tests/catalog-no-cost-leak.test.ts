// CLAUDE.md rule 1: Site.costCents must never leave the server.
// CLAUDE.md rule 5: publisher contact details must never reach an advertiser.
//
// These assert against the serialized payload rather than the typed object,
// because the leak that matters is whatever actually goes over the wire.

import { describe, expect, it, vi } from "vitest";
import { GET as getSites } from "@/app/api/sites/route";
import { GET as getFacets } from "@/app/api/sites/facets/route";
import { prisma } from "@/lib/db";
import { MAX_LIMIT } from "@/lib/catalog/filters";

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

async function fetchCatalog(qs = "") {
  const res = await getSites(new Request(`${BASE}?${qs}`));
  const body = await res.json();
  return { status: res.status, body, raw: JSON.stringify(body) };
}

// Every filter shape the UI can produce, so no single code path escapes the check.
const QUERY_SHAPES = [
  "",
  "limit=100",
  "sort=dr",
  "sort=traffic",
  "sort=price_asc",
  "sort=price_desc",
  "sort=turnaround",
  "topic=finance,crypto",
  "country=US,GB&language=en",
  "drMin=40&drMax=90",
  "trafficMin=50000",
  "priceMinCents=1000&priceMaxCents=90000",
  "dofollow=true",
  "gaVerified=true",
  "maxTurnaroundDays=7",
  "accepts=crypto,forex",
];

describe("GET /api/sites does not leak internal pricing", () => {
  it.each(QUERY_SHAPES)("omits costCents for query %j", async (qs) => {
    const { status, raw, body } = await fetchCatalog(qs);
    expect(status).toBe(200);
    expect(body.sites.length).toBeGreaterThan(0);
    expect(raw).not.toContain("costCents");
    expect(raw.toLowerCase()).not.toContain("cost");
  });

  it("omits costCents for a domain search", async () => {
    // Term taken from a real row so this holds under any seed.
    const seedRow = (await fetchCatalog("limit=1")).body.sites[0];
    const term = seedRow.domain.slice(0, 5);

    const { status, body, raw } = await fetchCatalog(`q=${encodeURIComponent(term)}`);
    expect(status).toBe(200);
    expect(body.sites.length).toBeGreaterThan(0);
    expect(raw).not.toContain("costCents");
    expect(raw.toLowerCase()).not.toContain("cost");
  });

  it("omits costCents on every page of a keyset walk", async () => {
    // Page size derived from the catalog size so the walk really spans pages
    // under both the curated seed and the 5,000-row bulk seed. Clamped to
    // MAX_LIMIT: a quarter of the bulk catalog is far above the largest page
    // the route will serve, and an over-limit request is a 400 whose body has
    // no cursor — the walk would stop on page one and check nothing.
    const catalogSize = (await fetchCatalog("limit=1")).body.total as number;
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(catalogSize / 4)));

    let cursor: string | null = null;
    let pages = 0;
    do {
      const qs = `sort=dr&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const { raw, body } = await fetchCatalog(qs);
      expect(raw).not.toContain("costCents");
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 60);
    expect(pages).toBeGreaterThan(1);
  });

  it("never echoes a row when the query is rejected", async () => {
    const { status, raw } = await fetchCatalog("drMin=90&drMax=10");
    expect(status).toBe(400);
    expect(raw).not.toContain("costCents");
  });

  // A guard against someone widening the serializer later: the value we are
  // hiding must genuinely exist in the database for these tests to mean anything.
  it("has non-zero costCents in the database for the rows it serves", async () => {
    const { body } = await fetchCatalog("limit=5&sort=dr");
    const ids = body.sites.map((s: { id: string }) => s.id);
    const rows = await prisma.site.findMany({
      where: { id: { in: ids } },
      select: { costCents: true },
    });
    expect(rows.length).toBe(ids.length);
    expect(rows.every((r) => r.costCents > 0)).toBe(true);
  });

  it("keeps costCents strictly below priceCents so a leak would be detectable", async () => {
    // Scoped to catalog sites, excluding fixtures other suites create. Those
    // deliberately include loss-making and price-mutated rows, and a fixture
    // left behind by a failed run used to fail this as though it were a leak.
    const rows = await prisma.site.findMany({
      where: { NOT: { domain: { contains: "-site-" } } },
      select: { costCents: true, priceCents: true },
      take: 500,
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.costCents < r.priceCents)).toBe(true);
  });
});

describe("GET /api/sites does not leak publisher identity", () => {
  it("omits publisher fields entirely", async () => {
    const { raw } = await fetchCatalog("limit=100");
    expect(raw).not.toContain("publisherId");
    expect(raw).not.toContain("publisher");
    expect(raw).not.toContain("telegram");
    expect(raw).not.toContain("payoutNotes");
    expect(raw).not.toContain("reliability");
  });

  it("does not expose any seeded publisher email or handle", async () => {
    const publishers = await prisma.publisher.findMany();
    expect(publishers.length).toBeGreaterThan(0);

    const { raw } = await fetchCatalog("limit=100");
    for (const p of publishers) {
      if (p.email) expect(raw).not.toContain(p.email);
      if (p.telegram) expect(raw).not.toContain(p.telegram);
      expect(raw).not.toContain(p.name);
    }
  });

  it("keeps the facets endpoint clean too", async () => {
    const res = await getFacets();
    const raw = JSON.stringify(await res.json());
    expect(res.status).toBe(200);
    expect(raw.toLowerCase()).not.toContain("cost");
    expect(raw).not.toContain("publisher");
  });
});
