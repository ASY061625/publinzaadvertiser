/**
 * PHASE6.md acceptance tests — the ten, in the order they are listed there.
 *
 * Written before the features. Both subsystems are driven through injectable
 * fetchers rather than the network, so every failure mode in the spec's table
 * can be reproduced exactly and on demand.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { purgeUsers } from "./helpers/cleanup";
import { makeApprovedAdvertiser as createAdvertiser } from "./helpers/accounts";
import type { Actor } from "@/lib/data/actor";
import { createProject } from "@/lib/data/projects";
import { transitionItem } from "@/lib/data/item-status";
import { placeAndAuthorise } from "./helpers/pay";
import { parseFilters } from "@/lib/catalog/filters";
import { queryCatalog } from "@/lib/catalog/query";

import {
  refreshSiteMetrics,
  refreshDueSites,
  STALENESS_DAYS,
  isStale,
  resetMetricsSpend,
  setFakeMetricsProvider,
} from "@/lib/monitoring/metrics";
import {
  runCheckForItem,
  type FetchResult,
  setFakeFetcher,
} from "@/lib/monitoring/link-check";
import {
  refundEligibility,
  openAlerts,
  REQUIRED_SPAN_DAYS,
} from "@/lib/monitoring/guarantee";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;

// The catalog gate needs an approved actor. These tests are about metrics and
// link checks, not access control, so they read as staff.
const CATALOG_READER = {
  id: "phase6-reader",
  email: "phase6@example.test",
  role: "ADMIN",
  approved: true,
} as const;
const uid = () => `${SUFFIX}-${seq++}`;

const madeUsers: string[] = [];
const madeDomains: string[] = [];

const DAY = 24 * 60 * 60 * 1000;
const TARGET = "https://client.example/landing";

async function makeAdvertiser(): Promise<Actor> {
  const actor = await createAdvertiser({
    email: `p6-${uid()}@example.test`,
    password: "correct-horse-battery",
  });
  madeUsers.push(actor.id);
  return actor;
}

async function makeSite(overrides: Record<string, unknown> = {}) {
  const domain = `p6-site-${uid()}.example`;
  madeDomains.push(domain);
  return prisma.site.create({
    data: {
      domain,
      country: "US",
      language: "en",
      costCents: 4_000,
      priceCents: 10_000,
      writingCents: 0,
      turnaroundDays: 7,
      guaranteeDays: 90,
      acceptsSensitive: [],
      ...overrides,
    },
  });
}

/** A published, verified placement — the thing the guarantee runs on. */
async function makeLivePlacement(actor: Actor, publishedUrl = "https://pub.example/post") {
  const project = await createProject(actor, {
    name: `P6 ${uid()}`,
    targetUrl: "https://client.example",
  });
  const site = await makeSite();

  const order = await placeAndAuthorise(actor, {
    idempotencyKey: `p6-${uid()}`,
    projectId: project.id,
    items: [
      { siteId: site.id, targetUrl: TARGET, anchorText: "best widgets", contentSource: "ADVERTISER" },
    ],
  });

  const item = (await prisma.orderItem.findFirst({ where: { orderId: order.id } }))!;
  await transitionItem(actor, item.id, "SUBMITTED_TO_PUBLISHER");
  await transitionItem(actor, item.id, "PUBLISHED", { publishedUrl });
  await transitionItem(actor, item.id, "VERIFIED");

  return { item, site, order };
}

/** A page that contains the bought link, dofollow, with the sold anchor. */
function livePage(overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    ok: true,
    httpStatus: 200,
    finalUrl: "https://pub.example/post",
    redirectCount: 0,
    body: `<article><a href="${TARGET}">best widgets</a></article>`,
    indexed: true,
    ...overrides,
  };
}

beforeEach(() => {
  setFakeFetcher(null);
  setFakeMetricsProvider(null);
});

afterAll(async () => {
  await purgeUsers(madeUsers);
  await prisma.metricsRefreshLog.deleteMany({});
  await prisma.metricsSpend.deleteMany({});
  await prisma.site.deleteMany({ where: { domain: { in: madeDomains } } });
});

/* ─────────────────────────────  1  ───────────────────────────── */

describe("1. a failed metrics call keeps existing values and the site visible", () => {
  it("leaves SiteMetric intact and the site in the catalog", async () => {
    const site = await makeSite();
    await prisma.siteMetric.create({
      data: {
        siteId: site.id,
        domainRating: 62,
        organicTraffic: 120_000,
        refDomains: 900,
        fetchedAt: new Date(Date.now() - 5 * DAY),
      },
    });

    setFakeMetricsProvider({
      async fetchMetrics() {
        throw new Error("DataForSEO returned 502");
      },
    });

    const result = await refreshSiteMetrics(site.id);
    expect(result.succeeded).toBe(false);

    // Last known values survive — a site whose call errored has stale data,
    // not zero traffic.
    const metric = await prisma.siteMetric.findUnique({ where: { siteId: site.id } });
    expect(metric!.domainRating).toBe(62);
    expect(metric!.organicTraffic).toBe(120_000);

    const stillActive = await prisma.site.findUnique({ where: { id: site.id } });
    expect(stillActive!.isActive).toBe(true);

    const catalog = await queryCatalog(CATALOG_READER,
      parseFilters(new URLSearchParams(`q=${site.domain}&limit=10`))
    );
    expect(catalog.sites.map((s) => s.id)).toContain(site.id);
  });

  it("records the failure without touching the metrics row's fetchedAt", async () => {
    const site = await makeSite();
    const fetchedAt = new Date(Date.now() - 9 * DAY);
    await prisma.siteMetric.create({
      data: { siteId: site.id, domainRating: 40, fetchedAt },
    });

    setFakeMetricsProvider({
      async fetchMetrics() {
        throw new Error("timeout");
      },
    });
    await refreshSiteMetrics(site.id);

    const metric = await prisma.siteMetric.findUnique({ where: { siteId: site.id } });
    expect(metric!.fetchedAt.toISOString()).toBe(fetchedAt.toISOString());

    const log = await prisma.metricsRefreshLog.findFirst({
      where: { siteId: site.id },
      orderBy: { createdAt: "desc" },
    });
    expect(log!.succeeded).toBe(false);
    expect(log!.error).toMatch(/timeout/i);
  });
});

/* ─────────────────────────────  2  ───────────────────────────── */

describe("2. stale metrics are flagged", () => {
  it("marks metrics older than the threshold as stale", async () => {
    const fresh = await makeSite();
    const old = await makeSite();

    await prisma.siteMetric.create({
      data: { siteId: fresh.id, domainRating: 50, fetchedAt: new Date() },
    });
    await prisma.siteMetric.create({
      data: {
        siteId: old.id,
        domainRating: 50,
        fetchedAt: new Date(Date.now() - (STALENESS_DAYS + 5) * DAY),
      },
    });

    expect(isStale(new Date())).toBe(false);
    expect(isStale(new Date(Date.now() - (STALENESS_DAYS + 1) * DAY))).toBe(true);
    expect(isStale(null)).toBe(true);

    const catalog = await queryCatalog(CATALOG_READER, parseFilters(new URLSearchParams("limit=100")));
    const freshRow = catalog.sites.find((s) => s.id === fresh.id);
    const oldRow = catalog.sites.find((s) => s.id === old.id);

    // The catalog payload carries the flag, so the UI can show it without
    // recomputing a threshold of its own.
    expect(freshRow!.metrics!.stale).toBe(false);
    expect(oldRow!.metrics!.stale).toBe(true);
  });
});

/* ─────────────────────────────  3  ───────────────────────────── */

describe("3. the daily spend cap halts lookups and alerts", () => {
  it("stops before exceeding the cap and records the alert", async () => {
    await resetMetricsSpend();

    const sites = [];
    for (let i = 0; i < 5; i++) sites.push(await makeSite({ lastViewedAt: new Date() }));

    let calls = 0;
    setFakeMetricsProvider({
      async fetchMetrics() {
        calls += 1;
        return { domainRating: 55, organicTraffic: 1_000, refDomains: 10, spamScore: 1 };
      },
    });

    // Cap allows exactly two lookups.
    const outcome = await refreshDueSites({
      siteIds: sites.map((s) => s.id),
      capMinor: 200,
      costPerLookupMinor: 100,
    });

    expect(calls).toBe(2);
    expect(outcome.refreshed).toBe(2);
    expect(outcome.capHit).toBe(true);
    expect(outcome.skippedForCap).toBe(3);

    const spend = await prisma.metricsSpend.findFirst({ orderBy: { day: "desc" } });
    expect(spend!.spentMinor).toBe(200);
    expect(spend!.capHitAt).not.toBeNull();
    // Alerted rather than silently stopping.
    expect(spend!.alertedAt).not.toBeNull();
  });

  it("refuses further lookups the same day once the cap is hit", async () => {
    await resetMetricsSpend();
    const site = await makeSite({ lastViewedAt: new Date() });

    setFakeMetricsProvider({
      async fetchMetrics() {
        return { domainRating: 10, organicTraffic: 1, refDomains: 1, spamScore: 0 };
      },
    });

    await refreshDueSites({ siteIds: [site.id], capMinor: 100, costPerLookupMinor: 100 });
    const second = await refreshDueSites({
      siteIds: [site.id],
      capMinor: 100,
      costPerLookupMinor: 100,
    });

    expect(second.refreshed).toBe(0);
    expect(second.capHit).toBe(true);
  });
});

/* ─────────────────────────────  4  ───────────────────────────── */

describe("4. a 200 with the link removed is recorded as link-absent", () => {
  it("distinguishes it from the article being gone", async () => {
    const actor = await makeAdvertiser();
    const { item } = await makeLivePlacement(actor);

    setFakeFetcher(async () =>
      livePage({ body: "<article>the article, now without the link</article>" })
    );

    const check = await runCheckForItem(item.id);

    expect(check!.httpStatus).toBe(200);
    expect(check!.linkPresent).toBe(false);
    expect(check!.outcome).toBe("LINK_ABSENT");
    expect(check!.manualReview).toBe(false);
  });

  it("records ARTICLE_DELETED for a 404", async () => {
    const actor = await makeAdvertiser();
    const { item } = await makeLivePlacement(actor);

    setFakeFetcher(async () => ({
      ok: true,
      httpStatus: 404,
      finalUrl: "https://pub.example/post",
      redirectCount: 0,
      body: "",
      indexed: false,
    }));

    const check = await runCheckForItem(item.id);
    expect(check!.outcome).toBe("ARTICLE_DELETED");
    expect(check!.linkPresent).toBe(false);
  });
});

/* ─────────────────────────────  5  ───────────────────────────── */

describe("5. a dofollow link quietly made nofollow is detected", () => {
  it("reports REL_CHANGED, not removal", async () => {
    const actor = await makeAdvertiser();
    const { item } = await makeLivePlacement(actor);

    setFakeFetcher(async () =>
      livePage({
        body: `<article><a href="${TARGET}" rel="nofollow">best widgets</a></article>`,
      })
    );

    const check = await runCheckForItem(item.id);

    expect(check!.linkPresent).toBe(true);
    expect(check!.linkTypeSeen).toBe("nofollow");
    expect(check!.outcome).toBe("REL_CHANGED");
    expect(check!.outcome).not.toBe("LINK_ABSENT");
  });

  it("reports ANCHOR_CHANGED when the anchor text was altered", async () => {
    const actor = await makeAdvertiser();
    const { item } = await makeLivePlacement(actor);

    setFakeFetcher(async () =>
      livePage({ body: `<article><a href="${TARGET}">click here</a></article>` })
    );

    const check = await runCheckForItem(item.id);
    expect(check!.linkPresent).toBe(true);
    expect(check!.outcome).toBe("ANCHOR_CHANGED");
    expect(check!.anchorTextSeen).toBe("click here");
  });
});

/* ─────────────────────────────  6  ───────────────────────────── */

describe("6. a blocked fetch is manual review, never a failure", () => {
  it.each([403, 429])("flags a %i for manual review", async (status) => {
    const actor = await makeAdvertiser();
    const { item } = await makeLivePlacement(actor);

    setFakeFetcher(async () => ({
      ok: true,
      httpStatus: status,
      finalUrl: "https://pub.example/post",
      redirectCount: 0,
      body: "",
      indexed: null,
    }));

    const check = await runCheckForItem(item.id);

    expect(check!.outcome).toBe("BLOCKED");
    expect(check!.manualReview).toBe(true);

    // A publisher blocking datacentre IPs must never count toward a refund.
    const eligibility = await refundEligibility(item.id);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.failedChecks).toBe(0);
  });

  it("treats a Cloudflare challenge as blocked even on a 200", async () => {
    const actor = await makeAdvertiser();
    const { item } = await makeLivePlacement(actor);

    setFakeFetcher(async () =>
      livePage({ body: "<html><title>Just a moment...</title>cf-browser-verification</html>" })
    );

    const check = await runCheckForItem(item.id);
    expect(check!.outcome).toBe("BLOCKED");
    expect(check!.manualReview).toBe(true);
  });

  it("treats a network error as manual review, not a dead link", async () => {
    const actor = await makeAdvertiser();
    const { item } = await makeLivePlacement(actor);

    setFakeFetcher(async () => ({
      ok: false,
      httpStatus: null,
      finalUrl: null,
      redirectCount: 0,
      body: "",
      indexed: null,
      error: "ECONNRESET",
    }));

    const check = await runCheckForItem(item.id);
    expect(check!.outcome).toBe("FETCH_ERROR");
    expect(check!.manualReview).toBe(true);
    expect((await refundEligibility(item.id)).eligible).toBe(false);
  });
});

/* ─────────────────────────────  7  ───────────────────────────── */

describe("7. refund eligibility needs three failures across three days", () => {
  it("is not eligible after one failure", async () => {
    const actor = await makeAdvertiser();
    const { item } = await makeLivePlacement(actor);

    setFakeFetcher(async () => livePage({ body: "<article>gone</article>" }));
    await runCheckForItem(item.id);

    const eligibility = await refundEligibility(item.id);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.failedChecks).toBe(1);
  });

  it("is not eligible for three failures inside a single day", async () => {
    const actor = await makeAdvertiser();
    const { item } = await makeLivePlacement(actor);

    setFakeFetcher(async () => livePage({ body: "<article>gone</article>" }));
    for (let i = 0; i < 3; i++) await runCheckForItem(item.id);

    const eligibility = await refundEligibility(item.id);
    expect(eligibility.failedChecks).toBe(3);
    // Three checks, but they span minutes — a transient outage must not
    // bankrupt us on same-day retries.
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.spanDays).toBeLessThan(3);
  });

  it("becomes eligible at three consecutive failures spanning three days", async () => {
    const actor = await makeAdvertiser();
    const { item } = await makeLivePlacement(actor);

    setFakeFetcher(async () => livePage({ body: "<article>gone</article>" }));
    for (let i = 0; i < 3; i++) await runCheckForItem(item.id);

    // Spread the three failures so the first and last are four days apart.
    // Note the arithmetic: checks at 3, 2 and 1 days ago span only *two* days,
    // which would not satisfy the rule — the span is between first and last,
    // not the number of distinct days touched.
    const checks = await prisma.linkCheck.findMany({
      where: { orderItemId: item.id },
      orderBy: { checkedAt: "asc" },
    });
    for (const [i, check] of checks.entries()) {
      await prisma.linkCheck.update({
        where: { id: check.id },
        data: { checkedAt: new Date(Date.now() - (checks.length - 1 - i) * 2 * DAY) },
      });
    }

    const eligibility = await refundEligibility(item.id);
    expect(eligibility.failedChecks).toBe(3);
    expect(eligibility.spanDays).toBeGreaterThanOrEqual(REQUIRED_SPAN_DAYS);
    expect(eligibility.eligible).toBe(true);
  });

  it("flags for staff rather than auto-refunding", async () => {
    const actor = await makeAdvertiser();
    const { item } = await makeLivePlacement(actor);

    setFakeFetcher(async () => livePage({ body: "<article>gone</article>" }));
    for (let i = 0; i < 3; i++) await runCheckForItem(item.id);

    const checks = await prisma.linkCheck.findMany({
      where: { orderItemId: item.id },
      orderBy: { checkedAt: "asc" },
    });
    for (const [i, check] of checks.entries()) {
      await prisma.linkCheck.update({
        where: { id: check.id },
        data: { checkedAt: new Date(Date.now() - (checks.length - 1 - i) * 2 * DAY) },
      });
    }
    // A fourth failure today, which is what tips it over and raises the flag.
    await runCheckForItem(item.id);

    // The item is still VERIFIED; a human decides refund vs replacement.
    const reread = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(reread!.status).toBe("VERIFIED");
    expect(
      await prisma.transaction.count({ where: { orderItemId: item.id, type: "REFUND" } })
    ).toBe(0);

    const alerts = await openAlerts();
    const mine = alerts.find((a) => a.orderItemId === item.id);
    expect(mine).toBeTruthy();
    expect(mine!.refundEligibleAt).not.toBeNull();
  });
});

/* ─────────────────────────────  8  ───────────────────────────── */

describe("8. a redirect chain resolves and records the final URL", () => {
  it("records the final URL and the hop count", async () => {
    const actor = await makeAdvertiser();
    const { item } = await makeLivePlacement(actor, "https://pub.example/post");

    setFakeFetcher(async () =>
      livePage({ finalUrl: "https://pub.example/2026/01/post", redirectCount: 2 })
    );

    const check = await runCheckForItem(item.id);

    expect(check!.finalUrl).toBe("https://pub.example/2026/01/post");
    expect(check!.redirectCount).toBe(2);
    // The link is intact, so this is a move, not a loss.
    expect(check!.linkPresent).toBe(true);
    expect(check!.outcome).toBe("ARTICLE_MOVED");
  });

  it("keeps OK when a redirect lands on the same URL", async () => {
    const actor = await makeAdvertiser();
    const { item } = await makeLivePlacement(actor, "https://pub.example/post");

    setFakeFetcher(async () =>
      livePage({ finalUrl: "https://pub.example/post", redirectCount: 1 })
    );

    const check = await runCheckForItem(item.id);
    expect(check!.outcome).toBe("OK");
  });
});

/* ─────────────────────────────  9  ───────────────────────────── */

describe("9. every check writes exactly one row and history is never overwritten", () => {
  it("appends and never mutates", async () => {
    const actor = await makeAdvertiser();
    const { item } = await makeLivePlacement(actor);

    setFakeFetcher(async () => livePage());
    const first = await runCheckForItem(item.id);
    expect(await prisma.linkCheck.count({ where: { orderItemId: item.id } })).toBe(1);

    setFakeFetcher(async () => livePage({ body: "<article>gone</article>" }));
    const second = await runCheckForItem(item.id);
    expect(await prisma.linkCheck.count({ where: { orderItemId: item.id } })).toBe(2);

    // The earlier row is untouched — this history is the evidence for refunds.
    const reread = await prisma.linkCheck.findUnique({ where: { id: first!.id } });
    expect(reread!.outcome).toBe("OK");
    expect(reread!.linkPresent).toBe(true);
    expect(second!.id).not.toBe(first!.id);
  });

  it("writes one row per check even when the outcome repeats", async () => {
    const actor = await makeAdvertiser();
    const { item } = await makeLivePlacement(actor);

    setFakeFetcher(async () => livePage({ body: "<article>gone</article>" }));
    for (let i = 0; i < 4; i++) await runCheckForItem(item.id);

    expect(await prisma.linkCheck.count({ where: { orderItemId: item.id } })).toBe(4);
    // ...but only one alert for the one incident.
    expect(
      await prisma.linkAlert.count({ where: { orderItemId: item.id, resolvedAt: null } })
    ).toBe(1);
  });
});

/* ─────────────────────────────  10  ───────────────────────────── */

describe("10. restoring a removed link clears the alert on the next check", () => {
  it("resolves the alert", async () => {
    const actor = await makeAdvertiser();
    const { item } = await makeLivePlacement(actor);

    setFakeFetcher(async () => livePage());
    await runCheckForItem(item.id);

    // The link disappears.
    setFakeFetcher(async () => livePage({ body: "<article>gone</article>" }));
    await runCheckForItem(item.id);

    let open = await prisma.linkAlert.findMany({
      where: { orderItemId: item.id, resolvedAt: null },
    });
    expect(open).toHaveLength(1);

    // The publisher puts it back.
    setFakeFetcher(async () => livePage());
    const restored = await runCheckForItem(item.id);
    expect(restored!.outcome).toBe("OK");

    open = await prisma.linkAlert.findMany({
      where: { orderItemId: item.id, resolvedAt: null },
    });
    expect(open).toHaveLength(0);

    const resolved = await prisma.linkAlert.findFirst({ where: { orderItemId: item.id } });
    expect(resolved!.resolvedAt).not.toBeNull();
    expect(resolved!.resolution).toMatch(/restored/i);

    // And eligibility resets — the failures are no longer consecutive.
    const eligibility = await refundEligibility(item.id);
    expect(eligibility.failedChecks).toBe(0);
    expect(eligibility.eligible).toBe(false);
  });
});
