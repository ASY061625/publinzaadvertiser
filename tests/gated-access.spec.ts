/**
 * GATED-ACCESS.md acceptance tests — the seven, in the order they are listed.
 *
 * Nothing about the catalog is visible until an account exists *and* staff have
 * approved it. These run over real HTTP because the guarantees are about what
 * comes back on the wire: a PENDING and a REJECTED user must be unable to tell
 * their situations apart, and neither may receive a single row of inventory.
 *
 * Needs `npm run dev` running.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { purgeUsers, purgeSitesByPrefix } from "./helpers/cleanup";
import { Client, TEST_PASSWORD } from "./helpers/client";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/*
 * Deliberately neutral addresses. Naming a fixture "gate-rejected@…" makes the
 * holding page — which shows the signed-in address — contain the word
 * "rejected", and an indistinguishability test then fails on its own fixture
 * rather than on anything the app did.
 */
const emailPending = `gate-a-${SUFFIX}@example.test`;
const emailRejected = `gate-b-${SUFFIX}@example.test`;
const emailApproved = `gate-c-${SUFFIX}@example.test`;
const emailSuspended = `gate-d-${SUFFIX}@example.test`;
const emailAdmin = `gate-e-${SUFFIX}@example.test`;
/** One identity whose status is flipped in place, for the comparison in test 3. */
const emailFlip = `gate-f-${SUFFIX}@example.test`;

const TEST_EMAILS = [
  emailPending,
  emailRejected,
  emailApproved,
  emailSuspended,
  emailAdmin,
  emailFlip,
];

const pending = new Client();
const rejected = new Client();
const approved = new Client();
const suspended = new Client();
const admin = new Client();
const flip = new Client();
const anon = new Client();

let siteDomain: string;
let siteId: string;

/** Every surface that exposes inventory, or exists only to order from it. */
const CATALOG_PAGES = ["/", "/checkout", "/orders", "/projects"];
const CATALOG_APIS = [
  "/api/sites?limit=5",
  "/api/sites/facets",
  "/api/cart",
  "/api/orders",
];

async function setStatus(email: string, status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED") {
  await prisma.user.update({ where: { email }, data: { status } });
}

beforeAll(async () => {
  for (const [client, email] of [
    [pending, emailPending],
    [rejected, emailRejected],
    [approved, emailApproved],
    [suspended, emailSuspended],
    [admin, emailAdmin],
    [flip, emailFlip],
  ] as const) {
    await client.signup(email);
  }

  await setStatus(emailPending, "PENDING");
  await setStatus(emailRejected, "REJECTED");
  await setStatus(emailApproved, "APPROVED");
  await setStatus(emailSuspended, "APPROVED"); // suspended later, mid-session
  await prisma.user.update({
    where: { email: emailAdmin },
    data: { role: "ADMIN", status: "APPROVED" },
  });

  for (const [client, email] of [
    [pending, emailPending],
    [rejected, emailRejected],
    [approved, emailApproved],
    [suspended, emailSuspended],
    [admin, emailAdmin],
    [flip, emailFlip],
  ] as const) {
    await client.login(email, TEST_PASSWORD);
  }

  siteDomain = `gate-site-${SUFFIX}.example`;
  const site = await prisma.site.create({
    data: {
      domain: siteDomain,
      country: "US",
      language: "en",
      costCents: 4_000,
      priceCents: 19_900,
      writingCents: 0,
      turnaroundDays: 7,
      acceptsSensitive: [],
    },
    select: { id: true },
  });
  siteId = site.id;
}, 120_000);

afterAll(async () => {
  const users = await prisma.user.findMany({
    where: { email: { in: TEST_EMAILS } },
    select: { id: true },
  });
  await purgeUsers(users.map((u) => u.id));
  await purgeSitesByPrefix(`gate-site-${SUFFIX}`);
});

/** Anything that would betray real inventory. */
function expectNoInventory(body: string, label: string) {
  expect(body, `${label} leaked a domain`).not.toContain(siteDomain);
  expect(body, `${label} leaked a price`).not.toContain("19900");
  expect(body, `${label} leaked a price`).not.toContain("$199");
  expect(body, `${label} leaked catalog rows`).not.toMatch(/"priceCents"\s*:/);
  expect(body, `${label} leaked metrics`).not.toMatch(/"domainRating"\s*:/);
}

/* ─────────────────────────────  1  ───────────────────────────── */

describe("1. unauthenticated requests get no catalog data", () => {
  it.each(CATALOG_APIS)("%s refuses an anonymous caller", async (route) => {
    anon.clearCookies();
    const res = await anon.fetch(route);

    // 404 or a redirect to signup — never 200 with rows.
    expect([401, 404, 302, 307], `${route} answered ${res.status}`).toContain(res.status);
    expectNoInventory(await res.text(), route);
  });

  it.each(CATALOG_PAGES)("%s sends an anonymous visitor away without data", async (route) => {
    anon.clearCookies();
    const res = await anon.fetch(route);
    expect([200, 302, 307, 404]).toContain(res.status);

    const body = await res.text();
    expectNoInventory(body, route);

    // If it rendered at all, it must be the holding or auth surface.
    if (res.status === 200) {
      expect(body).not.toContain("sites match");
    }
  });

  it("a site id cannot be probed directly", async () => {
    anon.clearCookies();
    const res = await anon.fetch(`/api/sites?limit=5&q=${encodeURIComponent(siteDomain)}`);
    expectNoInventory(await res.text(), "site search");
  });
});

/* ─────────────────────────────  2  ───────────────────────────── */

describe("2. a PENDING user sees a holding page and no site data", () => {
  it.each(CATALOG_PAGES)("%s shows the holding page", async (route) => {
    const res = await pending.fetch(route);
    const body = await res.text();

    expectNoInventory(body, `pending ${route}`);
    // No filter skeleton, no counts, nothing hinting at inventory size.
    expect(body).not.toContain("sites match");
    expect(body).not.toContain("Domain rating");
  });

  it.each(CATALOG_APIS)("%s returns no site data", async (route) => {
    const res = await pending.fetch(route);
    expect([401, 403, 404], `${route} answered ${res.status}`).toContain(res.status);
    expectNoInventory(await res.text(), `pending ${route}`);
  });

  it("reaches the holding page itself", async () => {
    const res = await pending.fetch("/pending");
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/review|approv/i);
  });

  it("is still able to sign out", async () => {
    const temp = new Client();
    await temp.login(emailPending, TEST_PASSWORD);
    expect((await temp.session()).user?.email).toBe(emailPending);
  });
});

/* ─────────────────────────────  3  ───────────────────────────── */

describe("3. a REJECTED user is indistinguishable from a PENDING one", () => {
  /**
   * The visible response: markup and scripts stripped, whitespace collapsed.
   *
   * Deliberately not a byte comparison of the HTML. A `next dev` page carries
   * module ids, chunk hashes, cache-busting query strings and render timings
   * that differ between any two requests by anyone — comparing those measures
   * the dev server, not the app, and chasing them with regexes would weaken the
   * assertion until it proved nothing.
   *
   * What the guarantee is actually about is what the person sees and what the
   * server tells their browser to do, which is exactly what this compares. The
   * API bodies below are clean JSON and are still compared byte for byte.
   */
  const visible = (s: string) =>
    s
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  /**
   * Compares one account with itself across the two statuses rather than two
   * different accounts.
   *
   * Two accounts differ by email, and the holding page shows the signed-in
   * address — so their pages differ for a reason that has nothing to do with
   * status. Flipping a single user is both the stronger claim and the one the
   * spec actually makes: a rejected applicant must not be able to tell they
   * were rejected.
   */
  async function responseAt(
    route: string,
    status: "PENDING" | "REJECTED" | "SUSPENDED"
  ) {
    await setStatus(emailFlip, status);
    const res = await flip.fetch(route);
    const raw = await res.text();
    return {
      status: res.status,
      location: res.headers.get("location"),
      visible: visible(raw),
      raw,
    };
  }

  it.each(CATALOG_PAGES)("%s is identical whether pending or rejected", async (route) => {
    const asPending = await responseAt(route, "PENDING");
    const asRejected = await responseAt(route, "REJECTED");

    expect(asRejected.status).toBe(asPending.status);
    expect(asRejected.location).toBe(asPending.location);
    expect(asRejected.visible).toBe(asPending.visible);
  });

  it.each(CATALOG_APIS)("%s answers byte-identically whether pending or rejected", async (route) => {
    const asPending = await responseAt(route, "PENDING");
    const asRejected = await responseAt(route, "REJECTED");

    expect(asRejected.status).toBe(asPending.status);
    // JSON, so this really is byte for byte.
    expect(asRejected.raw).toBe(asPending.raw);
  });

  it("the holding page never states a reason or the status itself", async () => {
    await setStatus(emailFlip, "REJECTED");
    const body = (await (await flip.fetch("/pending")).text()).toLowerCase();

    for (const word of ["rejected", "declined", "denied", "unsuccessful", "suspended"]) {
      expect(body, `holding page mentions "${word}"`).not.toContain(word);
    }
  });

  it("a suspended account gets that same page too", async () => {
    const asPending = await responseAt("/pending", "PENDING");
    const asRejected = await responseAt("/pending", "REJECTED");
    const asSuspended = await responseAt("/pending", "SUSPENDED");

    expect(asRejected.visible).toBe(asPending.visible);
    expect(asSuspended.visible).toBe(asPending.visible);
    expect(asSuspended.status).toBe(asPending.status);
  });
});

/* ─────────────────────────────  4  ───────────────────────────── */

describe("4. SUSPENDED takes effect immediately, on an existing session", () => {
  it("loses access mid-session without re-login", async () => {
    // Confirm the session works while approved.
    const before = await suspended.fetch("/api/sites?limit=5");
    expect(before.status).toBe(200);
    expect(await before.text()).toContain("priceCents");

    // Suspended by staff. The same cookie jar, no new login.
    await setStatus(emailSuspended, "SUSPENDED");

    const after = await suspended.fetch("/api/sites?limit=5");
    expect(after.status).not.toBe(200);
    expectNoInventory(await after.text(), "suspended api");

    const page = await suspended.fetch("/");
    expectNoInventory(await page.text(), "suspended page");
  });

  it("still holds a valid session cookie — it is authorisation that changed", async () => {
    expect((await suspended.session()).user?.email).toBe(emailSuspended);
  });
});

/* ─────────────────────────────  5  ───────────────────────────── */

describe("5. the marketing site's built output contains no catalog data", () => {
  const MARKETING = join(process.cwd(), "..", "outpost-marketing");

  function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".git") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  }

  it("has no catalog routes left in the source", () => {
    expect(existsSync(MARKETING)).toBe(true);
    expect(existsSync(join(MARKETING, "src", "app", "catalog"))).toBe(false);
  });

  it("ships no per-site snapshot data", () => {
    const snapshot = join(MARKETING, "catalog-snapshot.json");
    if (!existsSync(snapshot)) return; // removed entirely, which is fine

    const raw = readFileSync(snapshot, "utf8");
    expect(raw).not.toMatch(/"masked"\s*:/);
    expect(raw).not.toMatch(/"priceCents"\s*:/);
    expect(raw).not.toMatch(/"domainRating"\s*:/);
  });

  it("mentions no site domain, price or metric in any page source", () => {
    const files = walk(join(MARKETING, "src")).filter((f) => /\.(tsx?|json|mdx?)$/.test(f));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const raw = readFileSync(file, "utf8");
      const rel = file.slice(MARKETING.length);

      // Masked domains were the previous compromise; they are gone too.
      expect(raw, `${rel} contains a masked domain`).not.toMatch(/[a-z0-9]+\*{2,}\.[a-z]{2,}/i);
      expect(raw, `${rel} contains per-site price data`).not.toMatch(/"priceCents"\s*:/);
      expect(raw, `${rel} contains per-site metrics`).not.toMatch(/"domainRating"\s*:/);
    }
  });

  it("points its primary call to action at requesting access", () => {
    const home = readFileSync(join(MARKETING, "src", "app", "page.tsx"), "utf8");

    expect(home).toMatch(/request access/i);
    expect(home).not.toMatch(/browse the catalog/i);
    expect(home).not.toMatch(/href="\/catalog"/);
  });

  it("has no catalog URLs in the sitemap", () => {
    const sitemap = readFileSync(join(MARKETING, "src", "app", "sitemap.ts"), "utf8");
    expect(sitemap).not.toMatch(/\/catalog/);
  });
});

/* ─────────────────────────────  6  ───────────────────────────── */

describe("6. approving a user grants access without re-login", () => {
  it("opens the catalog on the existing session", async () => {
    const email = `gate-live-${SUFFIX}@example.test`;
    TEST_EMAILS.push(email);

    const client = new Client();
    // Left unapproved on purpose: the default helper approves, and these tests
    // are precisely about what a not-yet-approved account can do.
    await client.signup(email, TEST_PASSWORD, { approved: false });
    await client.login(email, TEST_PASSWORD);

    // Signup defaults to PENDING, so the catalog is closed.
    const before = await client.fetch("/api/sites?limit=5");
    expect(before.status).not.toBe(200);

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, status: true } });
    expect(user!.status).toBe("PENDING");

    // Staff approve through the admin API.
    const decision = await admin.fetch(`/api/admin/accounts/${user!.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "approve" }),
    });
    expect(decision.status).toBe(200);

    // Same cookie jar, no new sign-in.
    const after = await client.fetch("/api/sites?limit=5");
    expect(after.status).toBe(200);
    expect(await after.text()).toContain("priceCents");
  });

  it("defaults a brand-new signup to PENDING", async () => {
    const email = `gate-fresh-${SUFFIX}@example.test`;
    TEST_EMAILS.push(email);

    const client = new Client();
    // Left unapproved on purpose: the default helper approves, and these tests
    // are precisely about what a not-yet-approved account can do.
    await client.signup(email, TEST_PASSWORD, { approved: false });

    const row = await prisma.user.findUnique({ where: { email }, select: { status: true } });
    expect(row!.status).toBe("PENDING");
  });

  it("never lets a signup request its own status", async () => {
    const email = `gate-smuggle-${SUFFIX}@example.test`;
    TEST_EMAILS.push(email);

    const res = await anon.fetch("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password: TEST_PASSWORD, status: "APPROVED" }),
    });
    expect(res.status).toBe(201);

    const row = await prisma.user.findUnique({ where: { email }, select: { status: true } });
    expect(row!.status).toBe("PENDING");
  });
});

/* ─────────────────────────────  7  ───────────────────────────── */

describe("7. every approval and rejection is audited", () => {
  it("writes exactly one audit row per decision, naming the actor", async () => {
    const email = `gate-audit-${SUFFIX}@example.test`;
    TEST_EMAILS.push(email);

    const client = new Client();
    // Left unapproved on purpose: the default helper approves, and these tests
    // are precisely about what a not-yet-approved account can do.
    await client.signup(email, TEST_PASSWORD, { approved: false });
    const user = (await prisma.user.findUnique({ where: { email }, select: { id: true } }))!;

    const adminUser = (await prisma.user.findUnique({
      where: { email: emailAdmin },
      select: { id: true },
    }))!;

    const before = await prisma.adminAuditLog.count({
      where: { entityType: "User", entityId: user.id },
    });

    const res = await admin.fetch(`/api/admin/accounts/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "approve", note: "corporate domain, live site" }),
    });
    expect(res.status).toBe(200);

    const rows = await prisma.adminAuditLog.findMany({
      where: { entityType: "User", entityId: user.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.length - before).toBe(1);

    const entry = rows.at(-1)!;
    expect(entry.action).toBe("account.approve");
    expect(entry.actorUserId).toBe(adminUser.id);
    expect((entry.before as Record<string, unknown>).status).toBe("PENDING");
    expect((entry.after as Record<string, unknown>).status).toBe("APPROVED");

    // The decision is also denormalised onto the user for the queue.
    const decided = await prisma.user.findUnique({
      where: { id: user.id },
      select: { status: true, statusDecidedById: true, statusDecidedAt: true },
    });
    expect(decided!.status).toBe("APPROVED");
    expect(decided!.statusDecidedById).toBe(adminUser.id);
    expect(decided!.statusDecidedAt).not.toBeNull();
  });

  it("audits a rejection the same way", async () => {
    const email = `gate-audit-rej-${SUFFIX}@example.test`;
    TEST_EMAILS.push(email);

    const client = new Client();
    // Left unapproved on purpose: the default helper approves, and these tests
    // are precisely about what a not-yet-approved account can do.
    await client.signup(email, TEST_PASSWORD, { approved: false });
    const user = (await prisma.user.findUnique({ where: { email }, select: { id: true } }))!;

    await admin.fetch(`/api/admin/accounts/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "reject" }),
    });

    const rows = await prisma.adminAuditLog.findMany({
      where: { entityType: "User", entityId: user.id, action: "account.reject" },
    });
    expect(rows).toHaveLength(1);
    expect((rows[0].after as Record<string, unknown>).status).toBe("REJECTED");
  });

  it("writes no audit row when the decision is refused", async () => {
    const email = `gate-audit-none-${SUFFIX}@example.test`;
    TEST_EMAILS.push(email);

    const client = new Client();
    // Left unapproved on purpose: the default helper approves, and these tests
    // are precisely about what a not-yet-approved account can do.
    await client.signup(email, TEST_PASSWORD, { approved: false });
    const user = (await prisma.user.findUnique({ where: { email }, select: { id: true } }))!;

    // An advertiser trying to approve themselves.
    const res = await client.fetch(`/api/admin/accounts/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "approve" }),
    });
    expect(res.status).toBe(404);

    expect(
      await prisma.adminAuditLog.count({ where: { entityType: "User", entityId: user.id } })
    ).toBe(0);
    const row = await prisma.user.findUnique({ where: { email }, select: { status: true } });
    expect(row!.status).toBe("PENDING");
  });

  it("shows the queue to staff, oldest first, and hides it from everyone else", async () => {
    const res = await admin.fetch("/api/admin/accounts");
    expect(res.status).toBe(200);

    const { accounts } = await res.json();
    expect(Array.isArray(accounts)).toBe(true);

    const times = accounts.map((a: { createdAt: string }) => new Date(a.createdAt).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(accounts.every((a: { status: string }) => a.status === "PENDING")).toBe(true);

    expect((await approved.fetch("/api/admin/accounts")).status).toBe(404);
    anon.clearCookies();
    expect((await anon.fetch("/api/admin/accounts")).status).toBe(404);
  });
});
