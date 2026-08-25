/**
 * Phase 6 over real HTTP: the cron endpoints and the staff monitoring queue.
 *
 * The advertiser boundary matters here too — link alerts are staff-only, and an
 * advertiser is deliberately never told automatically that a link they paid for
 * has gone.
 *
 * Needs `npm run dev` running.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { purgeUsers } from "./helpers/cleanup";
import { Client, TEST_PASSWORD } from "./helpers/client";
import { authoriseOverHttp } from "./helpers/pay";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const emailAdmin = `p6h-admin-${SUFFIX}@example.test`;
const emailAdv = `p6h-adv-${SUFFIX}@example.test`;
const TEST_EMAILS = [emailAdmin, emailAdv];

const admin = new Client();
const advertiser = new Client();
const anon = new Client();

let itemId: string;
let alertId: string;

beforeAll(async () => {
  await admin.signup(emailAdmin);
  await advertiser.signup(emailAdv);
  await prisma.user.update({ where: { email: emailAdmin }, data: { role: "ADMIN" } });

  await admin.login(emailAdmin, TEST_PASSWORD);
  await advertiser.login(emailAdv, TEST_PASSWORD);

  const site = await prisma.site.create({
    data: {
      domain: `p6h-site-${SUFFIX}.example`,
      country: "US",
      language: "en",
      costCents: 4_000,
      priceCents: 20_000,
      writingCents: 0,
      turnaroundDays: 5,
      guaranteeDays: 90,
      acceptsSensitive: [],
    },
    select: { id: true },
  });

  const project = await advertiser.fetch("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: "P6H", targetUrl: "https://p6h.example" }),
  });
  const projectId = (await project.json()).project.id;

  const order = await advertiser.fetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: `p6h-${SUFFIX}`,
      projectId,
      items: [
        {
          siteId: site.id,
          targetUrl: "https://p6h.example/landing",
          anchorText: "widgets",
          contentSource: "ADVERTISER",
        },
      ],
    }),
  });
  const placed = await order.json();
  itemId = placed.items[0].id;
  await authoriseOverHttp(advertiser, placed.id);

  // Drive it live, then plant a failing check history directly — the classifier
  // itself is covered by the acceptance suite.
  for (const [status, extra] of [
    ["SUBMITTED_TO_PUBLISHER", {}],
    ["PUBLISHED", { publishedUrl: "https://p6h-publisher.example/post" }],
    ["VERIFIED", {}],
  ] as const) {
    await admin.fetch(`/api/admin/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ status, ...extra }),
    });
  }

  const alert = await prisma.linkAlert.create({
    data: { orderItemId: itemId, outcome: "LINK_ABSENT", refundEligibleAt: new Date() },
  });
  alertId = alert.id;

  await prisma.linkCheck.create({
    data: {
      orderItemId: itemId,
      httpStatus: 403,
      linkPresent: false,
      outcome: "BLOCKED",
      manualReview: true,
      attempt: 3,
      note: "HTTP 403",
    },
  });
}, 60_000);

afterAll(async () => {
  const users = await prisma.user.findMany({
    where: { email: { in: TEST_EMAILS } },
    select: { id: true },
  });
  await purgeUsers(users.map((u) => u.id));
  await prisma.site.deleteMany({ where: { domain: { startsWith: `p6h-site-${SUFFIX}` } } });
});

describe("cron endpoints refuse unauthenticated callers", () => {
  it.each(["/api/cron/link-checks", "/api/cron/metrics-refresh"])(
    "404s %s without the secret",
    async (route) => {
      anon.clearCookies();
      const res = await anon.fetch(route, { method: "POST", body: "{}" });
      // 404 not 401: an unauthenticated caller should not learn a cron endpoint
      // lives here. These cost money to run.
      expect(res.status).toBe(404);
    }
  );

  it("404s even for a signed-in admin without the secret", async () => {
    const res = await admin.fetch("/api/cron/link-checks", { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
  });

  it("fails closed when CRON_SECRET is unset rather than running open", async () => {
    // The dev server has no CRON_SECRET, so a correct-looking header still fails.
    const res = await anon.fetch("/api/cron/link-checks", {
      method: "POST",
      headers: { "x-cron-secret": "guess" },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });
});

describe("the monitoring queue is staff-only", () => {
  it("shows staff the open alerts and the manual-review queue", async () => {
    const res = await admin.fetch("/api/admin/monitoring");
    expect(res.status).toBe(200);

    const body = await res.json();
    const mine = body.alerts.find((a: { orderItemId: string }) => a.orderItemId === itemId);
    expect(mine).toBeTruthy();
    expect(mine.refundEligibleAt).not.toBeNull();

    const review = body.manualReview.find(
      (r: { orderItemId: string }) => r.orderItemId === itemId
    );
    expect(review).toBeTruthy();
    expect(review.outcome).toBe("BLOCKED");
  });

  it("404s for an advertiser and for anonymous", async () => {
    expect((await advertiser.fetch("/api/admin/monitoring")).status).toBe(404);
    expect((await advertiser.fetch("/admin/monitoring")).status).toBe(404);

    anon.clearCookies();
    expect((await anon.fetch("/api/admin/monitoring")).status).toBe(404);
    expect((await anon.fetch("/admin/monitoring")).status).toBe(404);
  });

  it("never tells the advertiser their link is gone", async () => {
    // A first failure is verified by a human before anyone is told — a false
    // alarm about a link they paid for costs more trust than a day's delay.
    const orders = await (await advertiser.fetch("/api/orders")).text();
    expect(orders).not.toContain("LINK_ABSENT");
    expect(orders).not.toContain("linkAlert");
    expect(orders).not.toContain("refundEligible");
  });

  it("lets staff acknowledge an alert without refunding anything", async () => {
    const res = await admin.fetch("/api/admin/monitoring", {
      method: "PATCH",
      body: JSON.stringify({ alertId }),
    });
    expect(res.status).toBe(200);

    const alert = await prisma.linkAlert.findUnique({ where: { id: alertId } });
    expect(alert!.acknowledgedBy).toBeTruthy();
    expect(alert!.resolvedAt).toBeNull(); // acknowledging is not resolving

    // Crucially, no money moved.
    expect(
      await prisma.transaction.count({ where: { orderItemId: itemId, type: "REFUND" } })
    ).toBe(0);
    const item = await prisma.orderItem.findUnique({ where: { id: itemId } });
    expect(item!.status).toBe("VERIFIED");
  });

  it("resolves an alert when a replacement is agreed", async () => {
    const res = await admin.fetch("/api/admin/monitoring", {
      method: "PATCH",
      body: JSON.stringify({ alertId, resolution: "Replacement placement agreed" }),
    });
    expect(res.status).toBe(200);

    const alert = await prisma.linkAlert.findUnique({ where: { id: alertId } });
    expect(alert!.resolvedAt).not.toBeNull();
    expect(alert!.resolution).toMatch(/replacement/i);
  });

  it("renders the staff page with the alert on it", async () => {
    await prisma.linkAlert.create({
      data: { orderItemId: itemId, outcome: "LINK_ABSENT", refundEligibleAt: new Date() },
    });

    const html = await (await admin.fetch("/admin/monitoring")).text();
    expect(html).toContain("refund-eligible");
    expect(html).toContain("p6h-site-");
    // Cost stays admin-only even here.
    expect(html).not.toContain("costCents");
  });
});

describe("catalog staleness reaches the advertiser", () => {
  it("marks an old metrics reading stale in the API payload", async () => {
    const site = await prisma.site.findFirst({
      where: { domain: { startsWith: `p6h-site-${SUFFIX}` } },
      select: { id: true, domain: true },
    });
    await prisma.siteMetric.create({
      data: {
        siteId: site!.id,
        domainRating: 44,
        organicTraffic: 1_000,
        fetchedAt: new Date(Date.now() - 60 * 24 * 3600 * 1000),
      },
    });

    // Read as an approved account: the catalog is gated now, so an anonymous
    // fetch would 404 before it ever reached the staleness flag.
    const res = await advertiser.fetch(`/api/sites?q=${site!.domain}&limit=5`);
    expect(res.status).toBe(200);

    const { sites } = await res.json();
    const row = sites.find((s: { id: string }) => s.id === site!.id);
    expect(row.metrics.stale).toBe(true);

    // Still no cost anywhere on the advertiser-facing catalog.
    expect(JSON.stringify(sites)).not.toContain("costCents");
  });
});
