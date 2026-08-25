/**
 * Phase 3 over real HTTP: the order lifecycle driven the way the UI drives it,
 * plus the boundaries that must hold on the wire — no costCents on any
 * advertiser order route, no cross-user access, admin order routes 404 for
 * advertisers, and idempotent placement through the API.
 *
 * Needs `npm run dev` running.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { purgeUsers, purgeSitesByPrefix } from "./helpers/cleanup";
import { Client, TEST_PASSWORD } from "./helpers/client";
import { authoriseOverHttp } from "./helpers/pay";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const emailA = `p3h-a-${SUFFIX}@example.test`;
const emailB = `p3h-b-${SUFFIX}@example.test`;
const emailStaff = `p3h-staff-${SUFFIX}@example.test`;

const TEST_EMAILS = [emailA, emailB, emailStaff];

const alice = new Client();
const bob = new Client();
const staff = new Client();
const anon = new Client();

let aliceProjectId: string;
let siteIds: string[] = [];
let orderId: string;
let orderRef: string;
let itemIds: string[] = [];

async function makeSites(n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const site = await prisma.site.create({
      data: {
        domain: `p3h-site-${SUFFIX}-${i}.example`,
        country: "US",
        language: "en",
        costCents: 3_300 + i,
        priceCents: 12_000 + i * 500,
        writingCents: 1_500,
        turnaroundDays: 5,
        acceptsSensitive: [],
      },
      select: { id: true },
    });
    ids.push(site.id);
  }
  return ids;
}

beforeAll(async () => {
  await alice.signup(emailA);
  await bob.signup(emailB);
  await staff.signup(emailStaff);
  await prisma.user.update({ where: { email: emailStaff }, data: { role: "ADMIN" } });

  await alice.login(emailA, TEST_PASSWORD);
  await bob.login(emailB, TEST_PASSWORD);
  await staff.login(emailStaff, TEST_PASSWORD);

  const projectRes = await alice.fetch("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: "Alice Co", targetUrl: "https://alice-co.example" }),
  });
  aliceProjectId = (await projectRes.json()).project.id;

  siteIds = await makeSites(2);
}, 60_000);

afterAll(async () => {
  const users = await prisma.user.findMany({
    where: { email: { in: TEST_EMAILS } },
    select: { id: true },
  });
  await purgeUsers(users.map((u) => u.id));
  await purgeSitesByPrefix(`p3h-site-${SUFFIX}`);
});

describe("cart", () => {
  it("requires a session", async () => {
    anon.clearCookies();
    expect((await anon.fetch("/api/cart")).status).toBe(401);
  });

  it("adds lines and flags a duplicate site for the same project", async () => {
    for (const siteId of [siteIds[0], siteIds[1], siteIds[0]]) {
      const res = await alice.fetch("/api/cart", {
        method: "POST",
        body: JSON.stringify({ siteId, projectId: aliceProjectId }),
      });
      expect(res.status).toBe(201);
    }

    const cart = await (await alice.fetch("/api/cart")).json();
    expect(cart.lines).toHaveLength(3);
    expect(cart.duplicates).toHaveLength(1);
    expect(cart.duplicates[0].count).toBe(2);
  });

  it("never exposes costCents in the cart", async () => {
    const raw = await (await alice.fetch("/api/cart")).text();
    expect(raw).not.toContain("costCents");
    expect(raw.toLowerCase()).not.toContain("cost");
  });

  it("refuses to add against another user's project", async () => {
    const res = await bob.fetch("/api/cart", {
      method: "POST",
      body: JSON.stringify({ siteId: siteIds[0], projectId: aliceProjectId }),
    });
    expect(res.status).toBe(404);
  });

  it("clears", async () => {
    const res = await alice.fetch("/api/cart", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect((await res.json()).lines).toHaveLength(0);
  });
});

describe("placing an order over HTTP", () => {
  const key = `http-key-${SUFFIX}`;

  const payload = () => ({
    idempotencyKey: key,
    projectId: aliceProjectId,
    items: siteIds.map((siteId, i) => ({
      siteId,
      targetUrl: `https://alice-co.example/page-${i}`,
      anchorText: `anchor ${i}`,
      contentSource: "ADVERTISER",
    })),
  });

  it("places an order and returns a reference", async () => {
    const res = await alice.fetch("/api/orders", {
      method: "POST",
      body: JSON.stringify(payload()),
    });
    expect(res.status).toBe(201);

    const order = await res.json();
    orderId = order.id;
    orderRef = order.reference;
    itemIds = order.items.map((i: { id: string }) => i.id);

    expect(orderRef).toMatch(/^ORD-\d{4}-\d{5}$/);
    // Phase 5 changed this: an order is placed unpaid and only reaches
    // IN_PROGRESS once the provider authorises the payment.
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.totalCents).toBe(12_000 + 12_500);
    expect(order.items).toHaveLength(2);

    await authoriseOverHttp(alice, orderId);
    const paid = await (await alice.fetch(`/api/orders/${orderId}`)).json();
    expect(paid.order.status).toBe("IN_PROGRESS");
  });

  it("is idempotent — the same key returns the same order", async () => {
    const res = await alice.fetch("/api/orders", {
      method: "POST",
      body: JSON.stringify(payload()),
    });
    expect(res.status).toBe(200); // replay, not a new resource
    const again = await res.json();

    expect(again.id).toBe(orderId);
    expect(again.reference).toBe(orderRef);
    expect(await prisma.order.count({ where: { reference: orderRef } })).toBe(1);
  });

  it("refuses an order with no items", async () => {
    const res = await alice.fetch("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `empty-${SUFFIX}`,
        projectId: aliceProjectId,
        items: [],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("refuses a target URL that is not absolute", async () => {
    const res = await alice.fetch("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `bad-url-${SUFFIX}`,
        projectId: aliceProjectId,
        items: [{ siteId: siteIds[0], targetUrl: "/relative", anchorText: "a", contentSource: "ADVERTISER" }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("refuses a missing anchor", async () => {
    const res = await alice.fetch("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `no-anchor-${SUFFIX}`,
        projectId: aliceProjectId,
        items: [
          {
            siteId: siteIds[0],
            targetUrl: "https://alice-co.example/x",
            anchorText: "   ",
            contentSource: "ADVERTISER",
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("warns but allows a target host that is not the project's", async () => {
    const res = await alice.fetch("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `warn-${SUFFIX}`,
        projectId: aliceProjectId,
        items: [
          {
            siteId: siteIds[0],
            targetUrl: "https://blog.somewhere-else.example/post",
            anchorText: "elsewhere",
            contentSource: "ADVERTISER",
          },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(body.warnings[0].field).toBe("targetUrl");
  });
});

describe("advertiser order routes never carry costCents", () => {
  it("omits it from the list and the detail", async () => {
    const list = await (await alice.fetch("/api/orders")).text();
    const detail = await (await alice.fetch(`/api/orders/${orderId}`)).text();

    for (const raw of [list, detail]) {
      expect(raw).not.toContain("costCents");
      expect(raw.toLowerCase()).not.toContain("cost");
    }

    const stored = await prisma.orderItem.findFirst({
      where: { orderId },
      select: { costCents: true },
    });
    expect(stored!.costCents).toBeGreaterThan(0);
  });

  it("omits it from the order page HTML", async () => {
    const html = await (await alice.fetch(`/orders/${orderId}`)).text();
    expect(html).toContain("ORD-"); // the page really rendered

    expect(html).not.toContain("costCents");
    // The cost as it would be displayed. Not a bare "3300": Next's dev RSC
    // payload embeds performance timings like 33.00499999, so a raw digit
    // string matches by coincidence rather than because anything leaked.
    expect(html).not.toContain("$33.00");
  });
});

describe("cross-user access to orders", () => {
  it("B cannot read A's order", async () => {
    expect((await bob.fetch(`/api/orders/${orderId}`)).status).toBe(404);
    const list = await (await bob.fetch("/api/orders")).json();
    expect(list.orders).toHaveLength(0);
  });

  it("B cannot cancel an item on A's order", async () => {
    const res = await bob.fetch(`/api/orders/${orderId}/items/${itemIds[0]}/cancel`, {
      method: "POST",
    });
    expect(res.status).toBe(404);

    const item = await prisma.orderItem.findUnique({ where: { id: itemIds[0] } });
    expect(item!.status).toBe("QUEUED");
  });

  it("B gets a 404 page for A's order detail", async () => {
    expect((await bob.fetch(`/orders/${orderId}`)).status).toBe(404);
  });
});

describe("admin order routes", () => {
  it("404 for an advertiser", async () => {
    expect((await alice.fetch("/api/admin/orders")).status).toBe(404);
    expect((await alice.fetch("/admin/orders")).status).toBe(404);
    expect((await alice.fetch(`/api/admin/items/${itemIds[0]}`)).status).toBe(404);

    const patch = await alice.fetch(`/api/admin/items/${itemIds[0]}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "SUBMITTED_TO_PUBLISHER" }),
    });
    expect(patch.status).toBe(404);

    const item = await prisma.orderItem.findUnique({ where: { id: itemIds[0] } });
    expect(item!.status).toBe("QUEUED");
  });

  it("404 for a signed-out visitor", async () => {
    anon.clearCookies();
    expect((await anon.fetch("/api/admin/orders")).status).toBe(404);
    expect((await anon.fetch("/admin/orders")).status).toBe(404);
  });

  it("shows staff the queue with cost and margin", async () => {
    const res = await staff.fetch("/api/admin/orders");
    expect(res.status).toBe(200);

    const body = await res.json();
    const mine = body.items.find((i: { id: string }) => i.id === itemIds[0]);
    expect(mine).toBeTruthy();
    expect(mine.costCents).toBeGreaterThan(0);
    expect(mine.marginCents).toBe(mine.priceCents - mine.costCents);
  });
});

describe("staff drive an order to COMPLETE and the advertiser sees it", () => {
  it("walks both items through the pipeline", async () => {
    for (const itemId of itemIds) {
      const submit = await staff.fetch(`/api/admin/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "SUBMITTED_TO_PUBLISHER", note: "sent" }),
      });
      expect(submit.status).toBe(200);

      // PUBLISHED without a URL must be refused.
      const noUrl = await staff.fetch(`/api/admin/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "PUBLISHED" }),
      });
      expect(noUrl.status).toBe(400);

      const publish = await staff.fetch(`/api/admin/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "PUBLISHED",
          publishedUrl: `https://publisher.example/${itemId}`,
        }),
      });
      expect(publish.status).toBe(200);

      const verify = await staff.fetch(`/api/admin/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "VERIFIED", note: "link live" }),
      });
      expect(verify.status).toBe(200);
    }
  });

  it("refuses an invalid transition with 409 and changes nothing", async () => {
    const res = await staff.fetch(`/api/admin/items/${itemIds[0]}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "QUEUED" }),
    });
    expect(res.status).toBe(409);

    const item = await prisma.orderItem.findUnique({ where: { id: itemIds[0] } });
    expect(item!.status).toBe("VERIFIED");
  });

  it("leaves the order COMPLETE and visible to the advertiser", async () => {
    const res = await alice.fetch(`/api/orders/${orderId}`);
    expect(res.status).toBe(200);

    const { order, history } = await res.json();
    expect(order.status).toBe("COMPLETE");
    expect(order.items.every((i: { status: string }) => i.status === "VERIFIED")).toBe(true);
    expect(order.items.every((i: { publishedUrl: string | null }) => !!i.publishedUrl)).toBe(true);

    // Placement + submit + publish + verify = four audited rows per item.
    for (const item of order.items) {
      expect(history[item.id]).toHaveLength(4);
      expect(history[item.id].map((h: { toStatus: string }) => h.toStatus)).toEqual([
        "QUEUED",
        "SUBMITTED_TO_PUBLISHER",
        "PUBLISHED",
        "VERIFIED",
      ]);
    }
  });

  it("shows the published URL on the advertiser's order page", async () => {
    const html = await (await alice.fetch(`/orders/${orderId}`)).text();
    expect(html).toContain("publisher.example");
    expect(html).not.toContain("costCents");
  });
});
