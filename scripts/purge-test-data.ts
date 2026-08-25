/**
 * Removes leftover test fixtures. Suite cleanups do this themselves, but a run
 * that dies mid-way leaves orphans behind, and orphan sites pollute the catalog
 * that the Phase 1 tests assert against.
 *
 * Only ever touches @example.test accounts and test-prefixed domains.
 */
import { prisma } from "../src/lib/db";
import { purgeUsers } from "../tests/helpers/cleanup";

const DOMAIN_PREFIXES = [
  "p3-site-", "p3h-site-", "p4-site-", "p4h-site-", "p5-site-", "gate-site-", "catalog-spec-", "p6-site-", "p6h-site-",
  "p4-audit-", "p4-csv-", "p4-editor-", "p4h-import-", "p4h-bad-",
  "demo4-", "probe-",
];

async function main() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: "@example.test" } },
    select: { id: true, email: true },
  });
  await purgeUsers(users.map((u) => u.id));
  console.log(`Removed ${users.length} test accounts and everything they owned.`);

  let sites = 0;
  for (const prefix of DOMAIN_PREFIXES) {
    const rows = await prisma.site.findMany({
      where: { domain: { startsWith: prefix } },
      select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) continue;

    await prisma.categoryOnSite.deleteMany({ where: { siteId: { in: ids } } });
    await prisma.sitePriceHistory.deleteMany({ where: { siteId: { in: ids } } });
    await prisma.siteMetric.deleteMany({ where: { siteId: { in: ids } } });
    await prisma.cartLine.deleteMany({ where: { siteId: { in: ids } } });
    sites += (await prisma.site.deleteMany({ where: { id: { in: ids } } })).count;
  }
  console.log(`Removed ${sites} test sites.`);
  console.log(`Catalog now holds ${await prisma.site.count()} sites.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
