/**
 * Demo data for walking Phase 4 through the UI: an ADMIN, an EDITOR colleague,
 * an advertiser, and one placement that is already overdue.
 *
 *   npx tsx scripts/demo-phase4.ts          # create
 *   npx tsx scripts/demo-phase4.ts --clean  # remove
 *
 * Only touches @example.test accounts, so real accounts are never affected.
 * Also writes a 50-row CSV to scratch/demo-catalog.csv for the import screen.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/db";
import { createAdvertiser } from "../src/lib/data/accounts";
import { createProject } from "../src/lib/data/projects";
import { placeOrder } from "../src/lib/data/orders";
import { transitionItem } from "../src/lib/data/item-status";

const ADMIN = "demo-admin@example.test";
const EDITOR = "demo-editor@example.test";
const ADVERTISER = "demo-adv4@example.test";
const PASSWORD = "correct-horse-battery";
const EMAILS = [ADMIN, EDITOR, ADVERTISER];

async function clean() {
  const users = await prisma.user.findMany({
    where: { email: { in: EMAILS } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return console.log("Nothing to clean.");

  const orders = await prisma.order.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);

  await prisma.itemCorrespondence.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
  await prisma.itemStatusEvent.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.cartLine.deleteMany({ where: { cart: { userId: { in: ids } } } });
  await prisma.cart.deleteMany({ where: { userId: { in: ids } } });
  await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  await prisma.adminAuditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.importLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.publisherNote.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.sitePriceHistory.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  await prisma.categoryOnSite.deleteMany({ where: { site: { domain: { startsWith: "demo4-" } } } });
  await prisma.sitePriceHistory.deleteMany({ where: { site: { domain: { startsWith: "demo4-" } } } });
  await prisma.site.deleteMany({ where: { domain: { startsWith: "demo4-" } } });
  await prisma.publisher.deleteMany({ where: { name: { startsWith: "Demo4 " } } });

  console.log("Removed the Phase 4 demo accounts, sites and orders.");
}

/** 50 rows using real category slugs, so the import is a realistic exercise. */
function buildCsv(categories: string[]) {
  const header =
    "domain,country,language,categories,cost,price,writing_price,turnaround_days,link_type," +
    "max_links,min_words,guarantee_days,accepts_sensitive,publisher_name,publisher_email," +
    "publisher_telegram,notes";

  const countries = ["US", "GB", "DE", "IN", "BR", "ES", "FR", "AU", "CA", "NL"];
  const languages = ["en", "en", "de", "en", "pt", "es", "fr", "en", "en", "nl"];

  const rows = Array.from({ length: 50 }, (_, i) => {
    const c = i % countries.length;
    const cost = 30 + ((i * 7) % 120);
    const price = Math.round(cost * 1.9);
    return [
      `demo4-import-${String(i + 1).padStart(2, "0")}.example`,
      countries[c],
      languages[c],
      categories[i % categories.length],
      cost,
      price,
      15,
      5 + (i % 10),
      "DOFOLLOW",
      2,
      700,
      90,
      "",
      `Demo4 Publisher ${(i % 5) + 1}`,
      `demo4-pub${(i % 5) + 1}@example.invalid`,
      `@demo4pub${(i % 5) + 1}`,
      "",
    ].join(",");
  });

  return [header, ...rows].join("\n");
}

async function main() {
  if (process.argv.includes("--clean")) return clean();
  await clean();

  const admin = await createAdvertiser({ email: ADMIN, password: PASSWORD, name: "Demo Admin" });
  const editor = await createAdvertiser({ email: EDITOR, password: PASSWORD, name: "Demo Editor" });
  const advertiser = await createAdvertiser({
    email: ADVERTISER,
    password: PASSWORD,
    name: "Demo Advertiser",
  });

  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  await prisma.user.update({ where: { id: editor.id }, data: { role: "EDITOR" } });

  const project = await createProject(advertiser, {
    name: "Demo Co",
    targetUrl: "https://demo-co.example",
  });

  // A site with a short turnaround, so the placement goes overdue immediately.
  const publisher = await prisma.publisher.create({
    data: { name: "Demo4 Slow Publisher", email: "demo4-slow@example.invalid" },
  });
  const site = await prisma.site.create({
    data: {
      domain: `demo4-overdue.example`,
      country: "US",
      language: "en",
      costCents: 4_000,
      priceCents: 15_000,
      writingCents: 2_000,
      turnaroundDays: 2,
      acceptsSensitive: [],
      publisherId: publisher.id,
    },
  });

  const order = await placeOrder(advertiser, {
    idempotencyKey: `demo4-${Date.now()}`,
    projectId: project.id,
    items: [
      {
        siteId: site.id,
        targetUrl: "https://demo-co.example/landing",
        anchorText: "demo anchor",
        contentSource: "ADVERTISER",
      },
    ],
  });

  const item = (await prisma.orderItem.findFirst({ where: { orderId: order.id } }))!;
  await transitionItem({ ...admin, role: "ADMIN" }, item.id, "SUBMITTED_TO_PUBLISHER", {
    note: "sent to publisher",
  });

  // Backdate the submission so it reads as overdue against a 2-day turnaround.
  await prisma.itemStatusEvent.updateMany({
    where: { orderItemId: item.id, toStatus: "SUBMITTED_TO_PUBLISHER" },
    data: { createdAt: new Date(Date.now() - 9 * 24 * 3600 * 1000) },
  });

  const categories = (await prisma.category.findMany({ select: { slug: true }, take: 6 })).map(
    (c) => c.slug
  );
  const csv = buildCsv(categories);
  const dir = join(process.cwd(), "scratch");
  mkdirSync(dir, { recursive: true });
  const csvPath = join(dir, "demo-catalog.csv");
  writeFileSync(csvPath, csv, "utf8");

  console.log(`Admin:      ${ADMIN} / ${PASSWORD}`);
  console.log(`Editor:     ${EDITOR} / ${PASSWORD}`);
  console.log(`Advertiser: ${ADVERTISER} / ${PASSWORD}`);
  console.log(`Order:      ${order.reference} (1 placement, overdue by ~7 days)`);
  console.log(`CSV:        ${csvPath} (50 rows)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
