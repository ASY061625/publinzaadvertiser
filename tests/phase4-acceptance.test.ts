/**
 * PHASE4.md acceptance tests — the eight, in the order they are listed there.
 *
 * Written before the features. Driven through the data layer, because PHASE4.md
 * requires the role split be enforced there rather than by hiding buttons; the
 * HTTP surface is covered by tests/phase4-http.spec.ts.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { purgeUsers, purgeSitesByPrefix } from "./helpers/cleanup";
import { makeApprovedAdvertiser as createAdvertiser } from "./helpers/accounts";
import { NotFoundError, ValidationError, type Actor } from "@/lib/data/actor";
import { createProject } from "@/lib/data/projects";
import { placeOrder } from "@/lib/data/orders";
import { placeAndAuthorise } from "./helpers/pay";
import { transitionItem } from "@/lib/data/item-status";
import { listQueue } from "@/lib/data/admin-orders";
import {
  createSite,
  deactivateSite,
  getSiteForEdit,
  listSitesAdmin,
  updateSite,
} from "@/lib/data/admin-sites";
import {
  createPublisher,
  getPublisher,
  recomputeReliability,
  updatePublisher,
} from "@/lib/data/admin-publishers";
import { commitImport, dryRunImport } from "@/lib/data/admin-import";
import { countAuditRows, listAuditLog } from "@/lib/data/audit";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
const uid = () => `${SUFFIX}-${seq++}`;

const madeUsers: string[] = [];
const madeSiteDomains: string[] = [];
const madePublishers: string[] = [];

let admin: Actor;
let editor: Actor;
let advertiser: Actor;

async function makeUser(tag: string, role: "ADMIN" | "EDITOR" | "ADVERTISER"): Promise<Actor> {
  const actor = await createAdvertiser({
    email: `p4-${tag}-${uid()}@example.test`,
    password: "correct-horse-battery",
  });
  madeUsers.push(actor.id);
  if (role !== "ADVERTISER") {
    await prisma.user.update({ where: { id: actor.id }, data: { role } });
  }
  return { ...actor, role };
}

async function makeSiteDirect(overrides: Record<string, unknown> = {}) {
  const domain = `p4-site-${uid()}.example`;
  madeSiteDomains.push(domain);
  return prisma.site.create({
    data: {
      domain,
      country: "US",
      language: "en",
      costCents: 4_000,
      priceCents: 10_000,
      writingCents: 1_000,
      turnaroundDays: 7,
      acceptsSensitive: [],
      ...overrides,
    },
  });
}

beforeAll(async () => {
  admin = await makeUser("admin", "ADMIN");
  editor = await makeUser("editor", "EDITOR");
  advertiser = await makeUser("adv", "ADVERTISER");

  // Category slugs the import tests reference must exist.
  for (const slug of ["technology", "finance"]) {
    await prisma.category.upsert({
      where: { slug },
      create: { slug, name: slug },
      update: {},
    });
  }
}, 60_000);

afterAll(async () => {
  await purgeUsers(madeUsers);
  await purgeSitesByPrefix("p4-");
  await prisma.publisher.deleteMany({ where: { id: { in: madePublishers } } });
});

/* ─────────────────────────────  1  ───────────────────────────── */

describe("1. an EDITOR is refused every pricing route and never sees costCents", () => {
  it("cannot list, read, create, edit or deactivate sites", async () => {
    const site = await makeSiteDirect();

    await expect(listSitesAdmin(editor, {})).rejects.toBeInstanceOf(NotFoundError);
    await expect(getSiteForEdit(editor, site.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createSite(editor, {
        domain: `p4-editor-${uid()}.example`,
        country: "US",
        language: "en",
        costCents: 1000,
        priceCents: 2000,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateSite(editor, site.id, { costCents: 1, priceCents: 2 })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deactivateSite(editor, site.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cannot import the catalog", async () => {
    await expect(dryRunImport(editor, "domain\nx.example\n")).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      commitImport(editor, "domain\nx.example\n", "x.csv")
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("sees the order queue but with no cost or margin anywhere in it", async () => {
    const project = await createProject(advertiser, {
      name: "Editor Vis",
      targetUrl: "https://editor-vis.example",
    });
    const site = await makeSiteDirect();
    await placeAndAuthorise(advertiser, {
      idempotencyKey: `p4-editor-${uid()}`,
      projectId: project.id,
      items: [
        {
          siteId: site.id,
          targetUrl: "https://editor-vis.example/a",
          anchorText: "a",
          contentSource: "ADVERTISER",
        },
      ],
    });

    const forEditor = await listQueue(editor, {});
    expect(forEditor.length).toBeGreaterThan(0);

    const raw = JSON.stringify(forEditor);
    expect(raw).not.toContain("costCents");
    expect(raw).not.toContain("marginCents");
    expect(raw.toLowerCase()).not.toContain("cost");
    expect(raw.toLowerCase()).not.toContain("margin");

    // The same call as ADMIN does carry them — otherwise this proves nothing.
    const forAdmin = await listQueue(admin, {});
    expect(JSON.stringify(forAdmin)).toContain("costCents");
  });
});

/* ─────────────────────────────  2  ───────────────────────────── */

describe("2. sites are never hard-deleted, only deactivated", () => {
  it("deactivating hides it from the catalog but keeps the row", async () => {
    const site = await makeSiteDirect();

    await deactivateSite(admin, site.id);

    const row = await prisma.site.findUnique({ where: { id: site.id } });
    expect(row).not.toBeNull();
    expect(row!.isActive).toBe(false);
  });

  it("an existing order still renders the domain of a deactivated site", async () => {
    const project = await createProject(advertiser, {
      name: "Deact",
      targetUrl: "https://deact.example",
    });
    const site = await makeSiteDirect();

    const order = await placeAndAuthorise(advertiser, {
      idempotencyKey: `p4-deact-${uid()}`,
      projectId: project.id,
      items: [
        {
          siteId: site.id,
          targetUrl: "https://deact.example/a",
          anchorText: "a",
          contentSource: "ADVERTISER",
        },
      ],
    });

    await deactivateSite(admin, site.id);

    const { getOrder } = await import("@/lib/data/orders");
    const reread = await getOrder(advertiser, order.id);
    expect(reread.items[0].domain).toBe(site.domain);
    expect(reread.items[0].priceCents).toBe(10_000);
  });

  it("exposes no hard-delete anywhere in the admin site module", async () => {
    const mod = await import("@/lib/data/admin-sites");
    const names = Object.keys(mod);
    expect(names.some((n) => /delete|destroy|remove/i.test(n))).toBe(false);
  });
});

/* ─────────────────────────────  3  ───────────────────────────── */

describe("3. saving price <= cost is blocked without a logged override", () => {
  it("refuses the save", async () => {
    const site = await makeSiteDirect();

    await expect(
      updateSite(admin, site.id, { costCents: 9_000, priceCents: 9_000 })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateSite(admin, site.id, { costCents: 9_000, priceCents: 5_000 })
    ).rejects.toBeInstanceOf(ValidationError);

    const unchanged = await prisma.site.findUnique({ where: { id: site.id } });
    expect(unchanged!.priceCents).toBe(10_000);
    expect(unchanged!.costCents).toBe(4_000);
  });

  it("requires a reason with the override", async () => {
    const site = await makeSiteDirect();
    await expect(
      updateSite(admin, site.id, { costCents: 9_000, priceCents: 9_000 }, { override: true })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows it with an explicit override and reason, and logs the reason", async () => {
    const site = await makeSiteDirect();

    await updateSite(
      admin,
      site.id,
      { costCents: 9_000, priceCents: 9_000 },
      { override: true, overrideReason: "Loss leader for a strategic publisher" }
    );

    const saved = await prisma.site.findUnique({ where: { id: site.id } });
    expect(saved!.priceCents).toBe(9_000);

    const history = await prisma.sitePriceHistory.findMany({ where: { siteId: site.id } });
    expect(history).toHaveLength(1);
    expect(history[0].overrideReason).toBe("Loss leader for a strategic publisher");
    expect(history[0].actorUserId).toBe(admin.id);
    expect(history[0].oldPriceCents).toBe(10_000);
    expect(history[0].newPriceCents).toBe(9_000);
  });

  it("records price history for ordinary edits too, without an override reason", async () => {
    const site = await makeSiteDirect();
    await updateSite(admin, site.id, { costCents: 5_000, priceCents: 20_000 });

    const history = await prisma.sitePriceHistory.findMany({ where: { siteId: site.id } });
    expect(history).toHaveLength(1);
    expect(history[0].overrideReason).toBeNull();
    expect(history[0].oldCostCents).toBe(4_000);
    expect(history[0].newCostCents).toBe(5_000);
  });
});

/* ─────────────────────────────  4  ───────────────────────────── */

const GOOD_HEADER =
  "domain,country,language,categories,cost,price,writing_price,turnaround_days,link_type,max_links,min_words,guarantee_days,accepts_sensitive,publisher_name,publisher_email,publisher_telegram,notes";

function csvRow(domain: string, over: Partial<Record<string, string>> = {}) {
  const base: Record<string, string> = {
    domain,
    country: "US",
    language: "en",
    categories: "technology",
    cost: "40",
    price: "100",
    writing_price: "10",
    turnaround_days: "7",
    link_type: "DOFOLLOW",
    max_links: "2",
    min_words: "700",
    guarantee_days: "90",
    accepts_sensitive: "",
    publisher_name: "CSV Publisher",
    publisher_email: "csv@example.invalid",
    publisher_telegram: "@csvpub",
    notes: "",
    ...over,
  };
  return GOOD_HEADER.split(",")
    .map((h) => base[h] ?? "")
    .join(",");
}

describe("4. a CSV with one bad row imports nothing and names that row", () => {
  it("reports the offending row and writes no sites", async () => {
    const okDomain = `p4-csv-ok-${uid()}.example`;
    const badDomain = `p4-csv-bad-${uid()}.example`;
    madeSiteDomains.push(okDomain, badDomain);

    // Row 3 has an unknown category slug — an error, never an auto-create.
    const csv = [
      GOOD_HEADER,
      csvRow(okDomain),
      csvRow(badDomain, { categories: "techonlogy" }),
    ].join("\n");

    const before = await prisma.site.count();

    const preview = await dryRunImport(admin, csv);
    expect(preview.errors).toHaveLength(1);
    expect(preview.errors[0].line).toBe(3);
    expect(preview.errors[0].message).toMatch(/categor/i);
    expect(preview.errors[0].message).toMatch(/techonlogy/);

    await expect(commitImport(admin, csv, "bad.csv")).rejects.toBeInstanceOf(ValidationError);

    expect(await prisma.site.count()).toBe(before);
    expect(await prisma.site.findUnique({ where: { domain: okDomain } })).toBeNull();
  });

  it("reports each kind of invalid field precisely", async () => {
    const cases: [Partial<Record<string, string>>, RegExp][] = [
      [{ country: "USA" }, /country/i],
      [{ language: "eng" }, /language/i],
      [{ price: "-5" }, /price/i],
      [{ cost: "abc" }, /cost/i],
      [{ accepts_sensitive: "weapons" }, /sensitive|restricted/i],
      [{ domain: "not a domain" }, /domain/i],
    ];

    for (const [over, pattern] of cases) {
      const csv = [GOOD_HEADER, csvRow(`p4-csv-${uid()}.example`, over)].join("\n");
      const preview = await dryRunImport(admin, csv);
      expect(preview.errors.length, JSON.stringify(over)).toBeGreaterThan(0);
      expect(preview.errors[0].message, JSON.stringify(over)).toMatch(pattern);
    }
  });

  it("nothing is written by a dry run even when the file is valid", async () => {
    const domain = `p4-csv-dry-${uid()}.example`;
    madeSiteDomains.push(domain);
    const csv = [GOOD_HEADER, csvRow(domain)].join("\n");

    const preview = await dryRunImport(admin, csv);
    expect(preview.created).toBe(1);
    expect(preview.errors).toHaveLength(0);
    expect(await prisma.site.findUnique({ where: { domain } })).toBeNull();
  });
});

/* ─────────────────────────────  5  ───────────────────────────── */

describe("5. re-importing the same CSV produces no duplicates", () => {
  it("matches on domain and updates instead of inserting", async () => {
    const domain = `p4-csv-idem-${uid()}.example`;
    madeSiteDomains.push(domain);
    const csv = [GOOD_HEADER, csvRow(domain)].join("\n");

    const first = await commitImport(admin, csv, "first.csv");
    expect(first.created).toBe(1);

    const second = await commitImport(admin, csv, "second.csv");
    expect(second.created).toBe(0);
    expect(second.unchanged + second.updated).toBe(1);

    expect(await prisma.site.count({ where: { domain } })).toBe(1);
  });

  it("updates the changed fields on a second import", async () => {
    const domain = `p4-csv-upd-${uid()}.example`;
    madeSiteDomains.push(domain);

    await commitImport(admin, [GOOD_HEADER, csvRow(domain)].join("\n"), "a.csv");
    const result = await commitImport(
      admin,
      [GOOD_HEADER, csvRow(domain, { price: "150" })].join("\n"),
      "b.csv"
    );

    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);

    const site = await prisma.site.findUnique({ where: { domain } });
    expect(site!.priceCents).toBe(15_000);
    expect(await prisma.site.count({ where: { domain } })).toBe(1);
  });
});

/* ─────────────────────────────  6  ───────────────────────────── */

describe("6. reliability score responds to delivery history", () => {
  async function publisherWithItems() {
    const publisher = await createPublisher(admin, {
      name: `Rel Pub ${uid()}`,
      email: "rel@example.invalid",
    });
    madePublishers.push(publisher.id);
    return publisher;
  }

  it("starts perfect for a publisher with no history", async () => {
    const publisher = await publisherWithItems();
    const score = await recomputeReliability(publisher.id);
    expect(score.reliability).toBe(100);
  });

  it("falls when an item is rejected", async () => {
    const publisher = await publisherWithItems();
    const site = await makeSiteDirect({ publisherId: publisher.id });
    const project = await createProject(advertiser, {
      name: "Rel",
      targetUrl: "https://rel.example",
    });

    const order = await placeAndAuthorise(advertiser, {
      idempotencyKey: `p4-rel-${uid()}`,
      projectId: project.id,
      items: [
        {
          siteId: site.id,
          targetUrl: "https://rel.example/a",
          anchorText: "a",
          contentSource: "ADVERTISER",
        },
      ],
    });
    const item = (await prisma.orderItem.findFirst({ where: { orderId: order.id } }))!;

    const before = (await recomputeReliability(publisher.id)).reliability;
    await transitionItem(admin, item.id, "REJECTED");
    const after = (await prisma.publisher.findUnique({ where: { id: publisher.id } }))!;

    expect(after.reliability).toBeLessThan(before);
    expect(after.rejectionRate).toBe(100);
  });

  it("falls when a placement publishes later than the quoted turnaround", async () => {
    const publisher = await publisherWithItems();
    const site = await makeSiteDirect({ publisherId: publisher.id, turnaroundDays: 1 });
    const project = await createProject(advertiser, {
      name: "Late",
      targetUrl: "https://late.example",
    });

    const order = await placeAndAuthorise(advertiser, {
      idempotencyKey: `p4-late-${uid()}`,
      projectId: project.id,
      items: [
        {
          siteId: site.id,
          targetUrl: "https://late.example/a",
          anchorText: "a",
          contentSource: "ADVERTISER",
        },
      ],
    });
    const item = (await prisma.orderItem.findFirst({ where: { orderId: order.id } }))!;

    await transitionItem(admin, item.id, "SUBMITTED_TO_PUBLISHER");

    // Backdate the submission so the publish is provably late.
    await prisma.itemStatusEvent.updateMany({
      where: { orderItemId: item.id, toStatus: "SUBMITTED_TO_PUBLISHER" },
      data: { createdAt: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
    });

    await transitionItem(admin, item.id, "PUBLISHED", {
      publishedUrl: "https://late.example/post",
    });

    const after = (await prisma.publisher.findUnique({ where: { id: publisher.id } }))!;
    expect(after.onTimeRate).toBe(0);
    expect(after.avgDaysOverQuoted).toBeGreaterThan(0);
    expect(after.reliability).toBeLessThan(100);
  });

  it("is recomputed on every status change, not hand-entered", async () => {
    const publisher = await publisherWithItems();
    // Setting it directly must not survive the next recompute.
    await prisma.publisher.update({ where: { id: publisher.id }, data: { reliability: 7 } });
    const score = await recomputeReliability(publisher.id);
    expect(score.reliability).toBe(100);
  });
});

/* ─────────────────────────────  7  ───────────────────────────── */

describe("7. publisher contact details reach no advertiser route", () => {
  it("is absent from catalog, order and cart payloads", async () => {
    const publisher = await createPublisher(admin, {
      name: `Secret Pub ${uid()}`,
      email: "secret@example.invalid",
      telegram: "@secretpub",
      payoutNotes: "wire monthly",
    });
    madePublishers.push(publisher.id);

    const site = await makeSiteDirect({ publisherId: publisher.id });
    const project = await createProject(advertiser, {
      name: "Pub",
      targetUrl: "https://pub.example",
    });

    const order = await placeAndAuthorise(advertiser, {
      idempotencyKey: `p4-pub-${uid()}`,
      projectId: project.id,
      items: [
        {
          siteId: site.id,
          targetUrl: "https://pub.example/a",
          anchorText: "a",
          contentSource: "ADVERTISER",
        },
      ],
    });

    const { getOrder, listOrders } = await import("@/lib/data/orders");
    const { queryCatalog } = await import("@/lib/catalog/query");
    const { parseFilters } = await import("@/lib/catalog/filters");

    const payloads = [
      JSON.stringify(await getOrder(advertiser, order.id)),
      JSON.stringify(await listOrders(advertiser, {})),
      JSON.stringify(await queryCatalog(admin, parseFilters(new URLSearchParams("limit=100")))),
    ];

    for (const payload of payloads) {
      expect(payload).not.toContain("secret@example.invalid");
      expect(payload).not.toContain("@secretpub");
      expect(payload).not.toContain("wire monthly");
      expect(payload).not.toContain(publisher.name);
      expect(payload).not.toContain("payoutNotes");
      expect(payload).not.toContain("reliability");
    }
  });

  it("an advertiser cannot read a publisher through the admin module", async () => {
    const publisher = await createPublisher(admin, { name: `Blocked ${uid()}` });
    madePublishers.push(publisher.id);

    await expect(getPublisher(advertiser, publisher.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updatePublisher(advertiser, publisher.id, { name: "hijack" })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

/* ─────────────────────────────  8  ───────────────────────────── */

describe("8. every admin write produces exactly one audit row", () => {
  it("logs a site create", async () => {
    const before = await countAuditRows({ entityType: "Site", action: "site.create" });
    const site = await createSite(admin, {
      domain: `p4-audit-${uid()}.example`,
      country: "US",
      language: "en",
      costCents: 4_000,
      priceCents: 10_000,
    });
    madeSiteDomains.push(site.domain);

    const after = await countAuditRows({ entityType: "Site", action: "site.create" });
    expect(after - before).toBe(1);

    const rows = await listAuditLog(admin, { entityType: "Site", entityId: site.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorUserId).toBe(admin.id);
    expect(rows[0].before).toBeNull();
    expect(rows[0].after).toBeTruthy();
  });

  it("logs a site update with before and after", async () => {
    const site = await makeSiteDirect();
    const before = await countAuditRows({ entityType: "Site", entityId: site.id });

    await updateSite(admin, site.id, { costCents: 4_500, priceCents: 11_000 });

    const after = await countAuditRows({ entityType: "Site", entityId: site.id });
    expect(after - before).toBe(1);

    const rows = await listAuditLog(admin, { entityType: "Site", entityId: site.id });
    const update = rows.find((r) => r.action === "site.update")!;
    expect((update.before as Record<string, unknown>).priceCents).toBe(10_000);
    expect((update.after as Record<string, unknown>).priceCents).toBe(11_000);
  });

  it("logs a deactivate", async () => {
    const site = await makeSiteDirect();
    const before = await countAuditRows({ entityType: "Site", entityId: site.id });
    await deactivateSite(admin, site.id);
    expect((await countAuditRows({ entityType: "Site", entityId: site.id })) - before).toBe(1);
  });

  it("logs publisher create and update once each", async () => {
    const publisher = await createPublisher(admin, { name: `Audit Pub ${uid()}` });
    madePublishers.push(publisher.id);

    expect(await countAuditRows({ entityType: "Publisher", entityId: publisher.id })).toBe(1);

    await updatePublisher(admin, publisher.id, { name: "Audit Pub renamed" });
    expect(await countAuditRows({ entityType: "Publisher", entityId: publisher.id })).toBe(2);
  });

  it("logs an import once, not once per row", async () => {
    const domains = [`p4-audit-i1-${uid()}.example`, `p4-audit-i2-${uid()}.example`];
    madeSiteDomains.push(...domains);
    const csv = [GOOD_HEADER, ...domains.map((d) => csvRow(d))].join("\n");

    const before = await countAuditRows({ entityType: "Import" });
    await commitImport(admin, csv, "audited.csv");
    expect((await countAuditRows({ entityType: "Import" })) - before).toBe(1);
  });

  it("writes no audit row when a write is refused", async () => {
    const site = await makeSiteDirect();
    const before = await countAuditRows({ entityType: "Site", entityId: site.id });

    await expect(
      updateSite(admin, site.id, { costCents: 9_000, priceCents: 1_000 })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(await countAuditRows({ entityType: "Site", entityId: site.id })).toBe(before);
  });

  it("keeps the audit log out of reach of an EDITOR and an advertiser", async () => {
    await expect(listAuditLog(editor, {})).rejects.toBeInstanceOf(NotFoundError);
    await expect(listAuditLog(advertiser, {})).rejects.toBeInstanceOf(NotFoundError);
  });
});
