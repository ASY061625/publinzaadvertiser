/**
 * PHASE3.md acceptance tests — the nine, in the order they are listed there.
 *
 * Written before the features. They drive the data layer directly, because that
 * is where the order lifecycle is enforced; the HTTP surface is covered by
 * tests/phase3-http.spec.ts.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { purgeUsers, purgeSitesByPrefix } from "./helpers/cleanup";
import { makeApprovedAdvertiser as createAdvertiser } from "./helpers/accounts";
import { NotFoundError, ValidationError, type Actor } from "@/lib/data/actor";
import { createProject } from "@/lib/data/projects";
import { addToCart, getCart } from "@/lib/data/cart";
import {
  cancelItem,
  getOrder,
  listOrders,
  placeOrder,
  type PlacementItem,
} from "@/lib/data/orders";
import { placeAndAuthorise } from "./helpers/pay";
import {
  ALLOWED_TRANSITIONS,
  deriveOrderStatus,
  itemHistory,
  transitionItem,
  TransitionError,
} from "@/lib/data/item-status";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let counter = 0;
const uniqueKey = () => `key-${SUFFIX}-${counter++}`;

const created: { users: string[] } = { users: [] };

async function makeAdvertiser(tag: string) {
  const actor = await createAdvertiser({
    email: `p3-${tag}-${SUFFIX}-${counter++}@example.test`,
    password: "correct-horse-battery",
  });
  created.users.push(actor.id);
  return actor;
}

async function makeProject(actor: Actor, host = "client.example") {
  return createProject(actor, { name: `Project ${host}`, targetUrl: `https://${host}` });
}

/** Two active sites with known prices, recreated per test so edits don't leak between them. */
async function makeSites(n = 2) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const site = await prisma.site.create({
      data: {
        domain: `p3-site-${SUFFIX}-${counter++}.example`,
        country: "US",
        language: "en",
        costCents: 4_000 + i * 100,
        priceCents: 10_000 + i * 1_000,
        writingCents: 2_000,
        turnaroundDays: 7,
        acceptsSensitive: [],
      },
    });
    rows.push(site);
  }
  return rows;
}

function itemsFor(sites: { id: string }[], targetHost = "client.example"): PlacementItem[] {
  return sites.map((s, i) => ({
    siteId: s.id,
    targetUrl: `https://${targetHost}/landing-${i}`,
    anchorText: `anchor ${i}`,
    contentSource: "ADVERTISER" as const,
  }));
}

afterAll(async () => {
  await purgeUsers(created.users);
  await purgeSitesByPrefix(`p3-site-${SUFFIX}`);
});

/* ─────────────────────────────  1  ───────────────────────────── */

describe("1. placing an order snapshots prices", () => {
  it("keeps the order total when the catalog price changes afterward", async () => {
    const actor = await makeAdvertiser("snap");
    const project = await makeProject(actor);
    const sites = await makeSites(2);

    const order = await placeAndAuthorise(actor, {
      idempotencyKey: uniqueKey(),
      projectId: project.id,
      items: itemsFor(sites),
    });

    const originalTotal = order.totalCents;
    expect(originalTotal).toBe(10_000 + 11_000);

    // Catalog price doubles after placement.
    await prisma.site.update({ where: { id: sites[0].id }, data: { priceCents: 99_999 } });

    const reread = await getOrder(actor, order.id);
    expect(reread.totalCents).toBe(originalTotal);
    expect(reread.subtotalCents).toBe(originalTotal);
    expect(reread.items.map((i) => i.priceCents).sort((a, b) => a - b)).toEqual([10_000, 11_000]);
  });

  it("snapshots costCents onto the item at placement", async () => {
    const actor = await makeAdvertiser("snapcost");
    const project = await makeProject(actor);
    const sites = await makeSites(1);

    const order = await placeAndAuthorise(actor, {
      idempotencyKey: uniqueKey(),
      projectId: project.id,
      items: itemsFor(sites),
    });

    await prisma.site.update({ where: { id: sites[0].id }, data: { costCents: 77_777 } });

    const row = await prisma.orderItem.findFirst({
      where: { orderId: order.id },
      select: { costCents: true, priceCents: true },
    });
    expect(row?.costCents).toBe(4_000);
    expect(row?.priceCents).toBe(10_000);
  });
});

/* ─────────────────────────────  2  ───────────────────────────── */

describe("2. costCents appears on no advertiser-facing order route", () => {
  it("is absent from getOrder and listOrders payloads", async () => {
    const actor = await makeAdvertiser("cost");
    const project = await makeProject(actor);
    const sites = await makeSites(2);

    const order = await placeAndAuthorise(actor, {
      idempotencyKey: uniqueKey(),
      projectId: project.id,
      items: itemsFor(sites),
    });

    const detail = JSON.stringify(await getOrder(actor, order.id));
    const list = JSON.stringify(await listOrders(actor, {}));

    for (const payload of [detail, list]) {
      expect(payload).not.toContain("costCents");
      expect(payload.toLowerCase()).not.toContain("cost");
    }

    // The value exists in the database — otherwise this test proves nothing.
    const stored = await prisma.orderItem.findFirst({
      where: { orderId: order.id },
      select: { costCents: true },
    });
    expect(stored!.costCents).toBeGreaterThan(0);
  });
});

/* ─────────────────────────────  3  ───────────────────────────── */

describe("3. idempotent placement", () => {
  it("creates exactly one order for a repeated key", async () => {
    const actor = await makeAdvertiser("idem");
    const project = await makeProject(actor);
    const sites = await makeSites(2);

    const key = uniqueKey();
    const payload = { idempotencyKey: key, projectId: project.id, items: itemsFor(sites) };

    const first = await placeAndAuthorise(actor, payload);
    const second = await placeAndAuthorise(actor, payload);

    expect(second.id).toBe(first.id);
    expect(second.reference).toBe(first.reference);

    const count = await prisma.order.count({ where: { userId: actor.id } });
    expect(count).toBe(1);

    const items = await prisma.orderItem.count({ where: { orderId: first.id } });
    expect(items).toBe(2);
  });

  it("creates one order when the same key is submitted concurrently", async () => {
    const actor = await makeAdvertiser("idem-race");
    const project = await makeProject(actor);
    const sites = await makeSites(2);

    const payload = {
      idempotencyKey: uniqueKey(),
      projectId: project.id,
      items: itemsFor(sites),
    };

    // A double-click fires both before either finishes.
    const results = await Promise.all([
      placeOrder(actor, payload),
      placeOrder(actor, payload),
      placeOrder(actor, payload),
    ]);

    const ids = new Set(results.map((o) => o.id));
    expect(ids.size).toBe(1);
    expect(await prisma.order.count({ where: { userId: actor.id } })).toBe(1);
  });

  it("does not let one user's key collide with another's", async () => {
    const a = await makeAdvertiser("idem-a");
    const b = await makeAdvertiser("idem-b");
    const pa = await makeProject(a);
    const pb = await makeProject(b);
    const sites = await makeSites(1);

    const shared = "same-client-key";
    const first = await placeAndAuthorise(a, {
      idempotencyKey: shared,
      projectId: pa.id,
      items: itemsFor(sites),
    });
    const second = await placeAndAuthorise(b, {
      idempotencyKey: shared,
      projectId: pb.id,
      items: itemsFor(sites),
    });

    expect(second.id).not.toBe(first.id);
  });
});

/* ─────────────────────────────  4  ───────────────────────────── */

describe("4. invalid transitions throw and change nothing", () => {
  it("rejects QUEUED → VERIFIED", async () => {
    const actor = await makeAdvertiser("trans");
    const project = await makeProject(actor);
    const sites = await makeSites(1);

    const order = await placeAndAuthorise(actor, {
      idempotencyKey: uniqueKey(),
      projectId: project.id,
      items: itemsFor(sites),
    });
    const item = (await prisma.orderItem.findFirst({ where: { orderId: order.id } }))!;
    expect(item.status).toBe("QUEUED");

    await expect(transitionItem(actor, item.id, "VERIFIED")).rejects.toBeInstanceOf(
      TransitionError
    );

    const after = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(after!.status).toBe("QUEUED");

    // A refused transition must not leave an audit row behind either.
    const events = await prisma.itemStatusEvent.count({ where: { orderItemId: item.id } });
    expect(events).toBe(1); // only the QUEUED row written at placement
  });

  it("refuses every transition the map does not allow", async () => {
    const actor = await makeAdvertiser("trans-map");
    const project = await makeProject(actor);
    const sites = await makeSites(1);
    const order = await placeAndAuthorise(actor, {
      idempotencyKey: uniqueKey(),
      projectId: project.id,
      items: itemsFor(sites),
    });
    const item = (await prisma.orderItem.findFirst({ where: { orderId: order.id } }))!;

    const disallowed = (["PUBLISHED", "VERIFIED", "REFUNDED", "REVISION_REQUESTED"] as const).filter(
      (s) => !ALLOWED_TRANSITIONS.QUEUED.includes(s)
    );
    expect(disallowed.length).toBeGreaterThan(0);

    for (const to of disallowed) {
      await expect(transitionItem(actor, item.id, to)).rejects.toBeInstanceOf(TransitionError);
    }
    const after = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(after!.status).toBe("QUEUED");
  });

  it("treats terminal statuses as terminal", async () => {
    expect(ALLOWED_TRANSITIONS.REJECTED).toEqual([]);
    expect(ALLOWED_TRANSITIONS.REFUNDED).toEqual([]);
  });
});

/* ─────────────────────────────  5  ───────────────────────────── */

describe("5. PUBLISHED requires a publishedUrl", () => {
  it("rejects PUBLISHED with no URL and keeps the previous status", async () => {
    const actor = await makeAdvertiser("pub");
    const project = await makeProject(actor);
    const sites = await makeSites(1);
    const order = await placeAndAuthorise(actor, {
      idempotencyKey: uniqueKey(),
      projectId: project.id,
      items: itemsFor(sites),
    });
    const item = (await prisma.orderItem.findFirst({ where: { orderId: order.id } }))!;

    await transitionItem(actor, item.id, "SUBMITTED_TO_PUBLISHER");

    await expect(transitionItem(actor, item.id, "PUBLISHED")).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(
      transitionItem(actor, item.id, "PUBLISHED", { publishedUrl: "   " })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      transitionItem(actor, item.id, "PUBLISHED", { publishedUrl: "not-a-url" })
    ).rejects.toBeInstanceOf(ValidationError);

    const after = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(after!.status).toBe("SUBMITTED_TO_PUBLISHER");
    expect(after!.publishedUrl).toBeNull();
  });

  it("accepts PUBLISHED with a URL and records it", async () => {
    const actor = await makeAdvertiser("pub-ok");
    const project = await makeProject(actor);
    const sites = await makeSites(1);
    const order = await placeAndAuthorise(actor, {
      idempotencyKey: uniqueKey(),
      projectId: project.id,
      items: itemsFor(sites),
    });
    const item = (await prisma.orderItem.findFirst({ where: { orderId: order.id } }))!;

    await transitionItem(actor, item.id, "SUBMITTED_TO_PUBLISHER");
    await transitionItem(actor, item.id, "PUBLISHED", {
      publishedUrl: "https://site.example/the-post",
    });

    const after = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(after!.status).toBe("PUBLISHED");
    expect(after!.publishedUrl).toBe("https://site.example/the-post");
    expect(after!.publishedAt).not.toBeNull();
  });
});

/* ─────────────────────────────  6  ───────────────────────────── */

describe("6. order status is derived from its items", () => {
  it("derives the pure cases", () => {
    expect(deriveOrderStatus(["QUEUED", "VERIFIED"])).toBe("IN_PROGRESS");
    expect(deriveOrderStatus(["VERIFIED", "VERIFIED"])).toBe("COMPLETE");
    expect(deriveOrderStatus(["REJECTED", "REJECTED"])).toBe("CANCELLED");
    expect(deriveOrderStatus(["REFUNDED", "REJECTED"])).toBe("CANCELLED");
    expect(deriveOrderStatus(["VERIFIED", "REJECTED"])).toBe("PARTIALLY_COMPLETE");
    expect(deriveOrderStatus(["VERIFIED", "REFUNDED"])).toBe("PARTIALLY_COMPLETE");
  });

  it("keeps the stored order status in step as items move", async () => {
    const actor = await makeAdvertiser("derive");
    const project = await makeProject(actor);
    const sites = await makeSites(2);
    const order = await placeAndAuthorise(actor, {
      idempotencyKey: uniqueKey(),
      projectId: project.id,
      items: itemsFor(sites),
    });

    const items = await prisma.orderItem.findMany({
      where: { orderId: order.id },
      orderBy: { id: "asc" },
    });
    expect((await getOrder(actor, order.id)).status).toBe("IN_PROGRESS");

    const drive = async (id: string) => {
      await transitionItem(actor, id, "SUBMITTED_TO_PUBLISHER");
      await transitionItem(actor, id, "PUBLISHED", {
        publishedUrl: `https://site.example/${id}`,
      });
      await transitionItem(actor, id, "VERIFIED");
    };

    await drive(items[0].id);
    expect((await getOrder(actor, order.id)).status).toBe("IN_PROGRESS");

    // All verified -> COMPLETE.
    await drive(items[1].id);
    expect((await getOrder(actor, order.id)).status).toBe("COMPLETE");
  });

  it("reaches PARTIALLY_COMPLETE when one item is rejected", async () => {
    const actor = await makeAdvertiser("derive-mixed");
    const project = await makeProject(actor);
    const sites = await makeSites(2);
    const order = await placeAndAuthorise(actor, {
      idempotencyKey: uniqueKey(),
      projectId: project.id,
      items: itemsFor(sites),
    });
    const items = await prisma.orderItem.findMany({
      where: { orderId: order.id },
      orderBy: { id: "asc" },
    });

    await transitionItem(actor, items[0].id, "SUBMITTED_TO_PUBLISHER");
    await transitionItem(actor, items[0].id, "PUBLISHED", {
      publishedUrl: "https://site.example/live",
    });
    await transitionItem(actor, items[0].id, "VERIFIED");
    await transitionItem(actor, items[1].id, "REJECTED");

    expect((await getOrder(actor, order.id)).status).toBe("PARTIALLY_COMPLETE");
  });

  it("reaches CANCELLED when every item is rejected", async () => {
    const actor = await makeAdvertiser("derive-cancel");
    const project = await makeProject(actor);
    const sites = await makeSites(2);
    const order = await placeAndAuthorise(actor, {
      idempotencyKey: uniqueKey(),
      projectId: project.id,
      items: itemsFor(sites),
    });
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });

    for (const item of items) await transitionItem(actor, item.id, "REJECTED");
    expect((await getOrder(actor, order.id)).status).toBe("CANCELLED");
  });
});

/* ─────────────────────────────  7  ───────────────────────────── */

describe("7. user B cannot touch user A's order or items", () => {
  it("cannot read, cancel, or transition another user's order", async () => {
    const alice = await makeAdvertiser("iso-a");
    const bob = await makeAdvertiser("iso-b");
    const project = await makeProject(alice);
    const sites = await makeSites(1);

    const order = await placeAndAuthorise(alice, {
      idempotencyKey: uniqueKey(),
      projectId: project.id,
      items: itemsFor(sites),
    });
    const item = (await prisma.orderItem.findFirst({ where: { orderId: order.id } }))!;

    // Read
    await expect(getOrder(bob, order.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listOrders(bob, {})).orders).toHaveLength(0);

    // Cancel
    await expect(cancelItem(bob, item.id)).rejects.toBeInstanceOf(NotFoundError);

    // Transition — an advertiser must not drive another's item, by any route.
    await expect(transitionItem(bob, item.id, "SUBMITTED_TO_PUBLISHER")).rejects.toBeTruthy();

    const after = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(after!.status).toBe("QUEUED");
    expect(await prisma.order.findUnique({ where: { id: order.id } })).not.toBeNull();
  });

  it("lets A cancel their own queued item", async () => {
    const alice = await makeAdvertiser("iso-own");
    const project = await makeProject(alice);
    const sites = await makeSites(1);
    const order = await placeAndAuthorise(alice, {
      idempotencyKey: uniqueKey(),
      projectId: project.id,
      items: itemsFor(sites),
    });
    const item = (await prisma.orderItem.findFirst({ where: { orderId: order.id } }))!;

    await cancelItem(alice, item.id);
    const after = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(after!.status).toBe("REJECTED");
  });

  it("refuses to cancel an item that has left QUEUED", async () => {
    const alice = await makeAdvertiser("iso-late");
    const project = await makeProject(alice);
    const sites = await makeSites(1);
    const order = await placeAndAuthorise(alice, {
      idempotencyKey: uniqueKey(),
      projectId: project.id,
      items: itemsFor(sites),
    });
    const item = (await prisma.orderItem.findFirst({ where: { orderId: order.id } }))!;

    await transitionItem(alice, item.id, "SUBMITTED_TO_PUBLISHER");
    await expect(cancelItem(alice, item.id)).rejects.toBeTruthy();
  });
});

/* ─────────────────────────────  8  ───────────────────────────── */

describe("8. an order with zero items cannot be placed", () => {
  it("rejects an empty item list and creates nothing", async () => {
    const actor = await makeAdvertiser("empty");
    const project = await makeProject(actor);

    await expect(
      placeOrder(actor, { idempotencyKey: uniqueKey(), projectId: project.id, items: [] })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(await prisma.order.count({ where: { userId: actor.id } })).toBe(0);
  });

  it("rejects placing from an empty cart", async () => {
    const actor = await makeAdvertiser("empty-cart");
    const project = await makeProject(actor);

    const cart = await getCart(actor);
    expect(cart.lines).toHaveLength(0);

    await expect(
      placeOrder(actor, { idempotencyKey: uniqueKey(), projectId: project.id, items: [] })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

/* ─────────────────────────────  9  ───────────────────────────── */

describe("9. every status change writes exactly one audit row", () => {
  it("records placement and each subsequent transition, with the right actor", async () => {
    const actor = await makeAdvertiser("audit");
    const project = await makeProject(actor);
    const sites = await makeSites(1);
    const order = await placeAndAuthorise(actor, {
      idempotencyKey: uniqueKey(),
      projectId: project.id,
      items: itemsFor(sites),
    });
    const item = (await prisma.orderItem.findFirst({ where: { orderId: order.id } }))!;

    // Placement itself is a status change and must be on the record.
    let history = await itemHistory(actor, item.id);
    expect(history).toHaveLength(1);
    expect(history[0].toStatus).toBe("QUEUED");
    expect(history[0].fromStatus).toBeNull();
    expect(history[0].actorUserId).toBe(actor.id);

    await transitionItem(actor, item.id, "SUBMITTED_TO_PUBLISHER", { note: "sent to publisher" });
    await transitionItem(actor, item.id, "PUBLISHED", {
      publishedUrl: "https://site.example/post",
    });
    await transitionItem(actor, item.id, "VERIFIED", { note: "link confirmed" });

    history = await itemHistory(actor, item.id);
    expect(history).toHaveLength(4);

    expect(history.map((h) => h.toStatus)).toEqual([
      "QUEUED",
      "SUBMITTED_TO_PUBLISHER",
      "PUBLISHED",
      "VERIFIED",
    ]);
    expect(history.map((h) => h.fromStatus)).toEqual([
      null,
      "QUEUED",
      "SUBMITTED_TO_PUBLISHER",
      "PUBLISHED",
    ]);
    expect(history.every((h) => h.actorUserId === actor.id)).toBe(true);
    expect(history[1].note).toBe("sent to publisher");
    expect(history[3].note).toBe("link confirmed");
  });

  it("attributes the row to whoever made the change", async () => {
    const advertiser = await makeAdvertiser("audit-adv");
    const editor = await makeAdvertiser("audit-editor");
    await prisma.user.update({ where: { id: editor.id }, data: { role: "EDITOR" } });
    const staff: Actor = { ...editor, role: "EDITOR" };

    const project = await makeProject(advertiser);
    const sites = await makeSites(1);
    const order = await placeAndAuthorise(advertiser, {
      idempotencyKey: uniqueKey(),
      projectId: project.id,
      items: itemsFor(sites),
    });
    const item = (await prisma.orderItem.findFirst({ where: { orderId: order.id } }))!;

    await transitionItem(staff, item.id, "SUBMITTED_TO_PUBLISHER");

    const rows = await prisma.itemStatusEvent.findMany({
      where: { orderItemId: item.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].actorUserId).toBe(advertiser.id);
    expect(rows[1].actorUserId).toBe(staff.id);
  });

  it("writes no audit row when a transition is refused", async () => {
    const actor = await makeAdvertiser("audit-none");
    const project = await makeProject(actor);
    const sites = await makeSites(1);
    const order = await placeAndAuthorise(actor, {
      idempotencyKey: uniqueKey(),
      projectId: project.id,
      items: itemsFor(sites),
    });
    const item = (await prisma.orderItem.findFirst({ where: { orderId: order.id } }))!;

    const before = await prisma.itemStatusEvent.count({ where: { orderItemId: item.id } });
    await expect(transitionItem(actor, item.id, "VERIFIED")).rejects.toBeTruthy();
    const after = await prisma.itemStatusEvent.count({ where: { orderItemId: item.id } });

    expect(after).toBe(before);
  });
});
