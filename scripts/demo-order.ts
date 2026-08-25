/**
 * Creates a small demo dataset for walking Phase 3 through the UI:
 * one advertiser with a project and a placed order, plus one staff account.
 *
 *   npx tsx scripts/demo-order.ts          # create
 *   npx tsx scripts/demo-order.ts --clean  # remove everything it made
 *
 * Only touches accounts under @example.test, so real accounts are never
 * affected.
 */
import { prisma } from "../src/lib/db";
import { createAdvertiser } from "../src/lib/data/accounts";
import { createProject } from "../src/lib/data/projects";
import { placeOrder } from "../src/lib/data/orders";

const ADVERTISER = "demo-adv@example.test";
const STAFF = "demo-staff@example.test";
const PASSWORD = "correct-horse-battery";

async function clean() {
  const users = await prisma.user.findMany({
    where: { email: { in: [ADVERTISER, STAFF] } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return console.log("Nothing to clean.");

  const orders = await prisma.order.findMany({
    where: { userId: { in: ids } },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);

  await prisma.itemStatusEvent.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.cartLine.deleteMany({ where: { cart: { userId: { in: ids } } } });
  await prisma.cart.deleteMany({ where: { userId: { in: ids } } });
  await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log("Removed the demo advertiser, the demo staff account, and their order.");
}

async function main() {
  if (process.argv.includes("--clean")) return clean();

  await clean(); // idempotent: rebuild from scratch each run

  const advertiser = await createAdvertiser({
    email: ADVERTISER,
    password: PASSWORD,
    name: "Demo Advertiser",
  });
  const staff = await createAdvertiser({ email: STAFF, password: PASSWORD, name: "Demo Staff" });
  await prisma.user.update({ where: { id: staff.id }, data: { role: "ADMIN" } });

  const project = await createProject(advertiser, {
    name: "Demo Co",
    targetUrl: "https://demo-co.example",
  });

  const sites = await prisma.site.findMany({
    where: { isActive: true },
    orderBy: { priceCents: "desc" },
    take: 2,
    select: { id: true, domain: true },
  });

  const order = await placeOrder(advertiser, {
    idempotencyKey: `demo-${Date.now()}`,
    projectId: project.id,
    items: sites.map((s, i) => ({
      siteId: s.id,
      targetUrl: `https://demo-co.example/landing-${i}`,
      anchorText: `demo anchor ${i}`,
      contentSource: "ADVERTISER" as const,
    })),
  });

  console.log(`Advertiser: ${ADVERTISER} / ${PASSWORD}`);
  console.log(`Staff:      ${STAFF} / ${PASSWORD}`);
  console.log(`Order:      ${order.reference} (${order.items.length} items, ${order.status})`);
  console.log(`Sites:      ${sites.map((s) => s.domain).join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
