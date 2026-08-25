/**
 * Phase 4 over real HTTP. The point of this suite is the role split: an EDITOR
 * is staff, reaches the order queue, and must still be refused every pricing
 * route with a 404 and never receive costCents in any response.
 *
 * Needs `npm run dev` running.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { purgeUsers, purgeSitesByPrefix } from "./helpers/cleanup";
import { Client, TEST_PASSWORD } from "./helpers/client";
import { authoriseOverHttp } from "./helpers/pay";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const emailAdmin = `p4h-admin-${SUFFIX}@example.test`;
const emailEditor = `p4h-editor-${SUFFIX}@example.test`;
const emailAdv = `p4h-adv-${SUFFIX}@example.test`;

const TEST_EMAILS = [emailAdmin, emailEditor, emailAdv];

const admin = new Client();
const editor = new Client();
const advertiser = new Client();
const anon = new Client();

let siteId: string;
let publisherId: string;
let itemId: string;

/** Every route that reads or writes cost. All must 404 for an EDITOR. */
const PRICING_ROUTES = [
  "/admin/sites",
  "/admin/import",
  "/admin/audit",
  "/api/admin/sites",
  "/api/admin/import",
  "/api/admin/audit",
];

beforeAll(async () => {
  await admin.signup(emailAdmin);
  await editor.signup(emailEditor);
  await advertiser.signup(emailAdv);

  await prisma.user.update({ where: { email: emailAdmin }, data: { role: "ADMIN" } });
  await prisma.user.update({ where: { email: emailEditor }, data: { role: "EDITOR" } });

  await admin.login(emailAdmin, TEST_PASSWORD);
  await editor.login(emailEditor, TEST_PASSWORD);
  await advertiser.login(emailAdv, TEST_PASSWORD);

  const publisher = await prisma.publisher.create({
    data: {
      name: `P4H Publisher ${SUFFIX}`,
      email: "p4h-secret@example.invalid",
      telegram: "@p4hsecret",
      payoutNotes: "net 30 by wire",
    },
    select: { id: true },
  });
  publisherId = publisher.id;

  const site = await prisma.site.create({
    data: {
      domain: `p4h-site-${SUFFIX}.example`,
      country: "US",
      language: "en",
      costCents: 3_700,
      priceCents: 12_000,
      writingCents: 1_000,
      turnaroundDays: 5,
      acceptsSensitive: [],
      publisherId,
    },
    select: { id: true },
  });
  siteId = site.id;

  // One placed order so the queue has something in it.
  const project = await advertiser.fetch("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: "P4H", targetUrl: "https://p4h.example" }),
  });
  const projectId = (await project.json()).project.id;

  const order = await advertiser.fetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: `p4h-${SUFFIX}`,
      projectId,
      items: [
        {
          siteId,
          targetUrl: "https://p4h.example/a",
          anchorText: "a",
          contentSource: "ADVERTISER",
        },
      ],
    }),
  });
  const placed = await order.json();
  itemId = placed.items[0].id;
  // Fulfilment needs an authorised payment from Phase 5 onward.
  await authoriseOverHttp(advertiser, placed.id);
}, 60_000);

afterAll(async () => {
  const users = await prisma.user.findMany({
    where: { email: { in: TEST_EMAILS } },
    select: { id: true },
  });
  await purgeUsers(users.map((u) => u.id));
  await purgeSitesByPrefix("p4h-");
  await prisma.publisher.deleteMany({ where: { id: publisherId } });
});

describe("an EDITOR is staff but not an admin", () => {
  it("reaches the admin home and the order queue", async () => {
    expect((await editor.fetch("/admin")).status).toBe(200);
    expect((await editor.fetch("/admin/orders")).status).toBe(200);
    expect((await editor.fetch("/api/admin/orders")).status).toBe(200);
  });

  it.each(PRICING_ROUTES)("gets 404 on %s", async (route) => {
    const res = await editor.fetch(route);
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it("cannot write through a pricing route", async () => {
    const create = await editor.fetch("/api/admin/sites", {
      method: "POST",
      body: JSON.stringify({
        domain: `p4h-editor-${SUFFIX}.example`,
        country: "US",
        language: "en",
        costCents: 100,
        priceCents: 200,
      }),
    });
    expect(create.status).toBe(404);

    const patch = await editor.fetch(`/api/admin/sites/${siteId}`, {
      method: "PATCH",
      body: JSON.stringify({ priceCents: 1 }),
    });
    expect(patch.status).toBe(404);

    const site = await prisma.site.findUnique({ where: { id: siteId } });
    expect(site!.priceCents).toBe(12_000);
  });

  it("receives no cost or margin anywhere in the queue payload", async () => {
    const raw = await (await editor.fetch("/api/admin/orders")).text();
    expect(raw).not.toContain("costCents");
    expect(raw).not.toContain("marginCents");
    expect(raw).not.toContain("3700");

    // The same endpoint as ADMIN does carry them.
    const asAdmin = await (await admin.fetch("/api/admin/orders")).text();
    expect(asAdmin).toContain("costCents");
  });

  it("receives no cost in the rendered queue page", async () => {
    const html = await (await editor.fetch("/admin/orders")).text();

    expect(html).toContain("p4h-site-"); // the page really did render the queue
    expect(html).not.toContain("costCents");
    expect(html).not.toContain("marginCents");
    expect(html).not.toContain("marginPct");

    // Asserted on the serialized props rather than on rendered text. Two
    // text-based attempts gave false failures: a bare "3700" collides with the
    // performance timings Next embeds in its dev RSC payload, and "margin"
    // matches the `margin-cell` CSS class that both roles get. The field check
    // is also strictly stronger — a field absent from the payload cannot be
    // rendered by any component.
    expect(html).not.toContain("$37.00");

    // And the ADMIN's render of the same page does carry it.
    const adminHtml = await (await admin.fetch("/admin/orders")).text();
    expect(adminHtml).toContain("costCents");
    expect(adminHtml).toContain("marginCents");
  });

  it("can still move an item through the pipeline", async () => {
    const res = await editor.fetch(`/api/admin/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "SUBMITTED_TO_PUBLISHER", note: "sent by editor" }),
    });
    expect(res.status).toBe(200);

    const item = await prisma.orderItem.findUnique({ where: { id: itemId } });
    expect(item!.status).toBe("SUBMITTED_TO_PUBLISHER");
  });

  it("sees publisher contact details but not payout notes", async () => {
    const res = await editor.fetch(`/api/admin/publishers/${publisherId}`);
    expect(res.status).toBe(200);

    const raw = await res.text();
    expect(raw).toContain("p4h-secret@example.invalid"); // needed to do the job
    expect(raw).not.toContain("net 30 by wire"); // commercial terms are ADMIN-only
    expect(raw).not.toContain("payoutNotes");
  });

  it("cannot edit a publisher record", async () => {
    const res = await editor.fetch(`/api/admin/publishers/${publisherId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "renamed by editor" }),
    });
    expect(res.status).toBe(404);

    const publisher = await prisma.publisher.findUnique({ where: { id: publisherId } });
    expect(publisher!.name).toContain("P4H Publisher");
  });
});

describe("an ADMIN reaches everything", () => {
  it("opens the pricing routes", async () => {
    for (const route of PRICING_ROUTES) {
      expect((await admin.fetch(route)).status, route).toBe(200);
    }
  });

  it("is blocked from saving price below cost, and can override with a reason", async () => {
    const blocked = await admin.fetch(`/api/admin/sites/${siteId}`, {
      method: "PATCH",
      body: JSON.stringify({ costCents: 9_000, priceCents: 5_000 }),
    });
    expect(blocked.status).toBe(400);
    expect((await blocked.json()).error).toMatch(/override/i);

    const allowed = await admin.fetch(`/api/admin/sites/${siteId}`, {
      method: "PATCH",
      body: JSON.stringify({
        costCents: 9_000,
        priceCents: 5_000,
        override: true,
        overrideReason: "strategic loss leader",
      }),
    });
    expect(allowed.status).toBe(200);

    const history = await prisma.sitePriceHistory.findMany({ where: { siteId } });
    expect(history.at(-1)!.overrideReason).toBe("strategic loss leader");
  });

  it("deactivates rather than deletes", async () => {
    const res = await admin.fetch(`/api/admin/sites/${siteId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect((await res.json()).note).toMatch(/never deleted/i);

    const site = await prisma.site.findUnique({ where: { id: siteId } });
    expect(site).not.toBeNull();
    expect(site!.isActive).toBe(false);

    // Restore for the remaining tests.
    await admin.fetch(`/api/admin/sites/${siteId}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "reactivate" }),
    });
  });

  it("runs a dry run that writes nothing, then commits", async () => {
    const domain = `p4h-import-${SUFFIX}.example`;
    const csv = [
      "domain,country,language,categories,cost,price",
      `${domain},US,en,,40,100`,
    ].join("\n");

    const dry = await admin.fetch("/api/admin/import", {
      method: "POST",
      body: JSON.stringify({ csv, fileName: "t.csv" }),
    });
    expect(dry.status).toBe(200);
    expect((await dry.json()).created).toBe(1);
    expect(await prisma.site.findUnique({ where: { domain } })).toBeNull();

    const commit = await admin.fetch("/api/admin/import", {
      method: "POST",
      body: JSON.stringify({ csv, fileName: "t.csv", confirm: true }),
    });
    expect(commit.status).toBe(200);
    expect(await prisma.site.findUnique({ where: { domain } })).not.toBeNull();

    await prisma.site.deleteMany({ where: { domain } });
  });

  it("reports a bad row and writes nothing", async () => {
    const domain = `p4h-bad-${SUFFIX}.example`;
    const csv = [
      "domain,country,language,categories,cost,price",
      `${domain},USA,en,,40,100`,
    ].join("\n");

    const dry = await admin.fetch("/api/admin/import", {
      method: "POST",
      body: JSON.stringify({ csv }),
    });
    const preview = await dry.json();
    expect(preview.errors).toHaveLength(1);
    expect(preview.errors[0].line).toBe(2);
    expect(preview.errors[0].message).toMatch(/country/i);

    const commit = await admin.fetch("/api/admin/import", {
      method: "POST",
      body: JSON.stringify({ csv, confirm: true }),
    });
    expect(commit.status).toBe(400);
    expect(await prisma.site.findUnique({ where: { domain } })).toBeNull();
  });
});

describe("advertisers and anonymous callers reach none of it", () => {
  const ALL_ADMIN = [...PRICING_ROUTES, "/admin", "/admin/orders", "/admin/publishers", "/api/admin/orders", "/api/admin/publishers"];

  it.each(ALL_ADMIN)("advertiser gets 404 on %s", async (route) => {
    expect((await advertiser.fetch(route)).status).toBe(404);
  });

  it.each(ALL_ADMIN)("anonymous gets 404 on %s", async (route) => {
    anon.clearCookies();
    expect((await anon.fetch(route)).status).toBe(404);
  });

  it("publisher contact details never reach an advertiser route", async () => {
    const catalog = await (await anon.fetch("/api/sites?limit=100")).text();
    const orders = await (await advertiser.fetch("/api/orders")).text();

    for (const raw of [catalog, orders]) {
      expect(raw).not.toContain("p4h-secret@example.invalid");
      expect(raw).not.toContain("@p4hsecret");
      expect(raw).not.toContain("net 30 by wire");
      expect(raw).not.toContain("payoutNotes");
      expect(raw).not.toContain("reliability");
    }
  });
});
