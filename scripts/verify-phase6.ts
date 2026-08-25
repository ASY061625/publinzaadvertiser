/**
 * PHASE6.md "done when", verified against a real page over real HTTP.
 *
 *   npx tsx scripts/verify-phase6.ts
 *
 * Stands up a local publisher page, removes the link from it, and runs the
 * actual link checker — the built-in fetcher, not the test double. Then proves
 * the three things the spec asks for:
 *
 *   1. the removal is flagged within one cycle
 *   2. a blocked fetch is distinguished from it and counts toward nothing
 *   3. nothing is refund-eligible until three checks fail across three days
 *
 * Cleans up everything it creates.
 */
import { createServer, type Server } from "node:http";
import { prisma } from "../src/lib/db";
import { createAdvertiser } from "../src/lib/data/accounts";
import { createProject } from "../src/lib/data/projects";
import { placeOrder } from "../src/lib/data/orders";
import { transitionItem } from "../src/lib/data/item-status";
import { beginCheckout, authorisePayment } from "../src/lib/payments/checkout";
import { runCheckForItem, setFakeFetcher } from "../src/lib/monitoring/link-check";
import { refundEligibility } from "../src/lib/monitoring/guarantee";

const PORT = 4599;
const TARGET = "https://verify-client.example/landing";
const ANCHOR = "best widgets";
const DAY = 24 * 60 * 60 * 1000;

type Mode = "live" | "removed" | "blocked" | "nofollow";
let mode: Mode = "live";

function pageFor(m: Mode): { status: number; body: string } {
  if (m === "blocked") return { status: 403, body: "Forbidden" };

  const link =
    m === "live"
      ? `<a href="${TARGET}">${ANCHOR}</a>`
      : m === "nofollow"
        ? `<a href="${TARGET}" rel="nofollow">${ANCHOR}</a>`
        : "";

  return {
    status: 200,
    body: `<!doctype html><html><body><article><h1>Sponsored post</h1><p>Body copy. ${link}</p></article></body></html>`,
  };
}

function startPublisher(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const { status, body } = pageFor(mode);
      res.writeHead(status, { "content-type": "text/html" });
      res.end(body);
    });
    server.listen(PORT, () => resolve(server));
  });
}

const line = (s: string) => console.log(s);
const ok = (label: string, pass: boolean, detail = "") =>
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);

async function main() {
  // The real fetcher, not the double.
  setFakeFetcher(null);

  const server = await startPublisher();
  const publishedUrl = `http://127.0.0.1:${PORT}/sponsored-post`;
  const stamp = `verify-${Date.now()}`;
  let failures = 0;

  try {
    const actor = await createAdvertiser({
      email: `${stamp}@example.test`,
      password: "correct-horse-battery",
    });
    const project = await createProject(actor, {
      name: "Verify Co",
      targetUrl: "https://verify-client.example",
    });
    const site = await prisma.site.create({
      data: {
        domain: `${stamp}.example`,
        country: "US",
        language: "en",
        costCents: 4_000,
        priceCents: 25_000,
        writingCents: 0,
        turnaroundDays: 5,
        guaranteeDays: 90,
        acceptsSensitive: [],
      },
    });

    const order = await placeOrder(actor, {
      idempotencyKey: stamp,
      projectId: project.id,
      items: [
        { siteId: site.id, targetUrl: TARGET, anchorText: ANCHOR, contentSource: "ADVERTISER" },
      ],
    });
    const checkout = await beginCheckout(actor, order.id);
    await authorisePayment(checkout.intentId);

    const item = (await prisma.orderItem.findFirst({ where: { orderId: order.id } }))!;
    await transitionItem(actor, item.id, "SUBMITTED_TO_PUBLISHER");
    await transitionItem(actor, item.id, "PUBLISHED", { publishedUrl });
    await transitionItem(actor, item.id, "VERIFIED");

    line(`\nPublisher page: ${publishedUrl}`);
    line(`Order ${order.reference}, placement worth $250.\n`);

    /* 1 — link live */
    line("1. Link present on the page");
    mode = "live";
    let check = await runCheckForItem(item.id);
    ok("recorded OK", check?.outcome === "OK", check?.outcome);
    ok("no alert raised", (await prisma.linkAlert.count({ where: { orderItemId: item.id, resolvedAt: null } })) === 0);
    if (check?.outcome !== "OK") failures++;

    /* 2 — link removed */
    line("\n2. Link removed from the page");
    mode = "removed";
    check = await runCheckForItem(item.id);
    const flagged = await prisma.linkAlert.findFirst({
      where: { orderItemId: item.id, resolvedAt: null },
    });
    ok("flagged within one cycle", check?.outcome === "LINK_ABSENT", check?.outcome);
    ok("alert opened for staff", !!flagged);
    ok("article itself still 200", check?.httpStatus === 200, String(check?.httpStatus));
    if (check?.outcome !== "LINK_ABSENT" || !flagged) failures++;

    let eligibility = await refundEligibility(item.id);
    ok("not refund-eligible after one failure", !eligibility.eligible, `${eligibility.failedChecks} failure(s)`);
    if (eligibility.eligible) failures++;

    /* 3 — publisher blocks us */
    line("\n3. Publisher blocks the crawler (403)");
    mode = "blocked";
    check = await runCheckForItem(item.id);
    ok("distinguished from removal", check?.outcome === "BLOCKED", check?.outcome);
    ok("sent to manual review", check?.manualReview === true);
    ok("retried before giving up", (check?.attempt ?? 0) > 1, `${check?.attempt} attempts`);
    if (check?.outcome !== "BLOCKED" || !check?.manualReview) failures++;

    eligibility = await refundEligibility(item.id);
    ok(
      "blocked fetch counts toward nothing",
      eligibility.failedChecks === 1,
      `${eligibility.failedChecks} counted failure(s)`
    );
    if (eligibility.failedChecks !== 1) failures++;

    /* 4 — three failures, same day */
    line("\n4. Three failures, all today");
    mode = "removed";
    await runCheckForItem(item.id);
    await runCheckForItem(item.id);
    eligibility = await refundEligibility(item.id);
    ok(
      "three failures but not eligible",
      eligibility.failedChecks >= 3 && !eligibility.eligible,
      `${eligibility.failedChecks} failures spanning ${eligibility.spanDays.toFixed(2)} days`
    );
    if (eligibility.eligible) failures++;

    /* 5 — spread across three days */
    line("\n5. The same three failures spread across three days");
    // Spread the *whole* history in creation order, not just the failures.
    // Backdating only the failures would leave the earlier passing check newer
    // than some of them, which correctly breaks the consecutive run — real
    // history is chronological, so the simulation has to be too.
    const checks = await prisma.linkCheck.findMany({
      where: { orderItemId: item.id },
      orderBy: { checkedAt: "asc" },
    });
    const spacing = 1.5 * DAY;
    for (const [i, c] of checks.entries()) {
      await prisma.linkCheck.update({
        where: { id: c.id },
        data: { checkedAt: new Date(Date.now() - (checks.length - 1 - i) * spacing) },
      });
    }
    eligibility = await refundEligibility(item.id);
    ok(
      "now refund-eligible",
      eligibility.eligible,
      `${eligibility.failedChecks} failures spanning ${eligibility.spanDays.toFixed(1)} days`
    );
    if (!eligibility.eligible) failures++;

    const stillVerified = await prisma.orderItem.findUnique({ where: { id: item.id } });
    const refunds = await prisma.transaction.count({
      where: { orderItemId: item.id, type: "REFUND" },
    });
    ok("nothing auto-refunded", refunds === 0 && stillVerified?.status === "VERIFIED");
    if (refunds !== 0) failures++;

    /* 6 — link restored */
    line("\n6. Publisher restores the link");
    mode = "live";
    check = await runCheckForItem(item.id);
    const openAfter = await prisma.linkAlert.count({
      where: { orderItemId: item.id, resolvedAt: null },
    });
    eligibility = await refundEligibility(item.id);
    ok("check passes again", check?.outcome === "OK", check?.outcome);
    ok("alert cleared", openAfter === 0);
    ok("eligibility reset", !eligibility.eligible && eligibility.failedChecks === 0);
    if (openAfter !== 0 || eligibility.eligible) failures++;

    /* history */
    const history = await prisma.linkCheck.count({ where: { orderItemId: item.id } });
    line(`\nLinkCheck rows written: ${history} (history is append-only)`);

    line(failures === 0 ? "\nAll done-when checks PASSED.\n" : `\n${failures} check(s) FAILED.\n`);

    /* cleanup */
    await prisma.linkAlert.deleteMany({ where: { orderItemId: item.id } });
    await prisma.linkCheck.deleteMany({ where: { orderItemId: item.id } });
    const { purgeUsers } = await import("../tests/helpers/cleanup");
    await purgeUsers([actor.id]);
    await prisma.site.deleteMany({ where: { domain: { startsWith: stamp } } });

    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
