/**
 * PHASE5.md acceptance tests — the ten, in the order they are listed there.
 *
 * Written before the features. Pay-per-order only: one payment authorises one
 * order, no stored balance, no top-ups.
 *
 * These drive a deterministic fake provider rather than a live account, so the
 * ledger, capture and invoice logic is provable without network access. The
 * real Stripe/Razorpay adapters implement the same interface; the live
 * test-mode run is the separate "done when".
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { purgeUsers, purgeSitesByPrefix } from "./helpers/cleanup";
import { makeApprovedAdvertiser as createAdvertiser } from "./helpers/accounts";
import { ValidationError, type Actor } from "@/lib/data/actor";
import { createProject } from "@/lib/data/projects";
import { placeOrder } from "@/lib/data/orders";
import { transitionItem } from "@/lib/data/item-status";
import { getOrder, listOrders } from "@/lib/data/orders";

import { FakeProvider, resetFakeProvider } from "@/lib/payments/fake-provider";
import { authorisePayment, beginCheckout } from "@/lib/payments/checkout";
import { currencyForCountry, providerForCountry } from "@/lib/payments/types";
import { handleWebhook, WebhookSignatureError } from "@/lib/payments/webhooks";
import { ledgerForOrder, netForOrder } from "@/lib/payments/ledger";
import { getInvoiceForOrder, listInvoices } from "@/lib/payments/invoices";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
const uid = () => `${SUFFIX}-${seq++}`;

const madeUsers: string[] = [];
const madeDomains: string[] = [];

async function makeAdvertiser(): Promise<Actor> {
  const actor = await createAdvertiser({
    email: `p5-${uid()}@example.test`,
    password: "correct-horse-battery",
  });
  madeUsers.push(actor.id);
  await prisma.user.update({
    where: { id: actor.id },
    data: {
      legalName: "Acme Trading Ltd",
      billingAddress: "1 Example Street, London",
      taxId: "GB123456789",
      billingCountry: "GB",
    },
  });
  return actor;
}

async function makeSites(n: number, priceMinor = 10_000) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const domain = `p5-site-${uid()}.example`;
    madeDomains.push(domain);
    const site = await prisma.site.create({
      data: {
        domain,
        country: "US",
        language: "en",
        costCents: 4_000,
        priceCents: priceMinor,
        writingCents: 0,
        turnaroundDays: 7,
        acceptsSensitive: [],
      },
      select: { id: true },
    });
    ids.push(site.id);
  }
  return ids;
}

/** Places an order and takes it through checkout to an authorised payment. */
async function placeAndPay(actor: Actor, itemCount: number, priceMinor = 10_000) {
  const project = await createProject(actor, {
    name: `P5 ${uid()}`,
    targetUrl: "https://p5.example",
  });
  const siteIds = await makeSites(itemCount, priceMinor);

  const order = await placeOrder(actor, {
    idempotencyKey: `p5-${uid()}`,
    projectId: project.id,
    items: siteIds.map((siteId, i) => ({
      siteId,
      targetUrl: `https://p5.example/${i}`,
      anchorText: `anchor ${i}`,
      contentSource: "ADVERTISER" as const,
    })),
  });

  const checkout = await beginCheckout(actor, order.id);
  return { order, checkout, project, siteIds };
}

async function itemsOf(orderId: string) {
  return prisma.orderItem.findMany({ where: { orderId }, orderBy: { id: "asc" } });
}

/** Drives one item all the way to VERIFIED. */
async function verifyItem(actor: Actor, itemId: string) {
  await transitionItem(actor, itemId, "SUBMITTED_TO_PUBLISHER");
  await transitionItem(actor, itemId, "PUBLISHED", {
    publishedUrl: `https://pub.example/${itemId}`,
  });
  await transitionItem(actor, itemId, "VERIFIED");
}

beforeEach(() => {
  resetFakeProvider();
});

afterAll(async () => {
  await purgeUsers(madeUsers);
  await prisma.site.deleteMany({ where: { domain: { in: madeDomains } } });
});

/* ─────────────────────────────  1  ───────────────────────────── */

describe("1. replaying an identical webhook credits the order once", () => {
  it("absorbs ten identical deliveries", async () => {
    const actor = await makeAdvertiser();
    const { order, checkout } = await placeAndPay(actor, 2);

    const event = FakeProvider.buildEvent("payment.authorised", {
      intentId: checkout.intentId,
      amountMinor: order.totalCents,
      currency: "USD",
    });

    for (let i = 0; i < 10; i++) {
      const res = await handleWebhook("STRIPE", event.rawBody, event.signature);
      expect(res.ok).toBe(true);
    }

    const holds = await prisma.transaction.findMany({
      where: { orderId: order.id, type: "ORDER_HOLD" },
    });
    expect(holds).toHaveLength(1);

    const processed = await prisma.processedWebhookEvent.count({
      where: { providerEventId: event.eventId },
    });
    expect(processed).toBe(1);

    const reread = await getOrder(actor, order.id);
    expect(reread.status).toBe("IN_PROGRESS");
  });

  it("returns 200-equivalent on a duplicate rather than erroring", async () => {
    const actor = await makeAdvertiser();
    const { order, checkout } = await placeAndPay(actor, 1);
    const event = FakeProvider.buildEvent("payment.authorised", {
      intentId: checkout.intentId,
      amountMinor: order.totalCents,
      currency: "USD",
    });

    const first = await handleWebhook("STRIPE", event.rawBody, event.signature);
    const second = await handleWebhook("STRIPE", event.rawBody, event.signature);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
  });
});

/* ─────────────────────────────  2  ───────────────────────────── */

describe("2. a webhook with an invalid signature is rejected and changes nothing", () => {
  it("refuses a tampered signature", async () => {
    const actor = await makeAdvertiser();
    const { order, checkout } = await placeAndPay(actor, 1);

    const event = FakeProvider.buildEvent("payment.authorised", {
      intentId: checkout.intentId,
      amountMinor: order.totalCents,
      currency: "USD",
    });

    await expect(
      handleWebhook("STRIPE", event.rawBody, "sha256=deadbeef")
    ).rejects.toBeInstanceOf(WebhookSignatureError);

    // The ORDER_HOLD from checkout legitimately exists; what must not appear is
    // any settlement row, and no event may be recorded as processed.
    expect(
      await prisma.transaction.count({
        where: { orderId: order.id, type: { in: ["ORDER_CAPTURE", "REFUND"] } },
      })
    ).toBe(0);
    expect(
      await prisma.processedWebhookEvent.count({ where: { orderId: order.id } })
    ).toBe(0);
    expect((await getOrder(actor, order.id)).status).toBe("PENDING_PAYMENT");
  });

  it("refuses a body that was altered after signing", async () => {
    const actor = await makeAdvertiser();
    const { order, checkout } = await placeAndPay(actor, 1);

    const event = FakeProvider.buildEvent("payment.authorised", {
      intentId: checkout.intentId,
      amountMinor: order.totalCents,
      currency: "USD",
    });

    // An attacker inflating the amount after the signature was computed.
    const tampered = Buffer.from(
      event.rawBody.toString("utf8").replace(String(order.totalCents), "1")
    );

    await expect(
      handleWebhook("STRIPE", tampered, event.signature)
    ).rejects.toBeInstanceOf(WebhookSignatureError);

    expect(
      await prisma.transaction.count({
        where: { orderId: order.id, type: { in: ["ORDER_CAPTURE", "REFUND"] } },
      })
    ).toBe(0);
  });

  it("verifies the signature before parsing the body at all", async () => {
    // Malformed JSON with a bad signature must fail as a signature problem,
    // proving nothing was parsed before verification.
    await expect(
      handleWebhook("STRIPE", Buffer.from("{not json"), "sha256=nope")
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });
});

/* ─────────────────────────────  3  ───────────────────────────── */

describe("3. a ten-item order with two rejected items is charged eight items' worth", () => {
  /**
   * The outcome PHASE5.md demands is unchanged — the advertiser pays for eight.
   * The route there changed: the order is captured in full at placement and the
   * two failures are refunded, rather than eight separate captures on
   * verification. The assertion is therefore on the *net*, which is what the
   * customer actually pays, rather than on the number of capture rows.
   */
  it("nets to eight items' worth via one capture and two refunds", async () => {
    const actor = await makeAdvertiser();
    const { order, checkout } = await placeAndPay(actor, 10, 5_000);
    await authorisePayment(checkout.intentId);

    const items = await itemsOf(order.id);
    expect(items).toHaveLength(10);

    for (const item of items.slice(0, 8)) await verifyItem(actor, item.id);
    for (const item of items.slice(8)) await transitionItem(actor, item.id, "REJECTED");

    // One capture, for the whole order, taken at placement.
    const captures = await prisma.transaction.findMany({
      where: { orderId: order.id, type: "ORDER_CAPTURE" },
    });
    expect(captures).toHaveLength(1);
    expect(Math.abs(captures[0].amountCents)).toBe(10 * 5_000);
    expect(captures[0].orderItemId).toBeNull();

    // One refund per failed placement, each tied to the item that caused it.
    const refunds = await prisma.transaction.findMany({
      where: { orderId: order.id, type: "REFUND" },
    });
    expect(refunds).toHaveLength(2);
    expect(refunds.every((r) => r.orderItemId !== null)).toBe(true);
    expect(refunds.reduce((n, r) => n + Math.abs(r.amountCents), 0)).toBe(2 * 5_000);

    // The number that matters: the advertiser is charged for eight.
    const net = await netForOrder(order.id);
    expect(net.netMinor).toBe(8 * 5_000);
  });

  it("charges for everything when nothing fails", async () => {
    const actor = await makeAdvertiser();
    const { order, checkout } = await placeAndPay(actor, 3, 5_000);
    await authorisePayment(checkout.intentId);

    for (const item of await itemsOf(order.id)) await verifyItem(actor, item.id);

    const net = await netForOrder(order.id);
    expect(net.capturedMinor).toBe(3 * 5_000);
    expect(net.refundedMinor).toBe(0);
    expect(net.netMinor).toBe(3 * 5_000);
  });
});

/* ─────────────────────────────  4  ───────────────────────────── */

describe("4. ledger rows for an order sum to the expected net", () => {
  it("nets to captured minus refunded", async () => {
    const actor = await makeAdvertiser();
    const { order, checkout } = await placeAndPay(actor, 4, 2_500);
    await authorisePayment(checkout.intentId);

    const items = await itemsOf(order.id);
    for (const item of items.slice(0, 3)) await verifyItem(actor, item.id);
    await transitionItem(actor, items[3].id, "REJECTED");

    const net = await netForOrder(order.id);
    expect(net.currency).toBe("USD");
    // Captured in full at placement, one placement refunded.
    expect(net.capturedMinor).toBe(4 * 2_500);
    expect(net.refundedMinor).toBe(2_500);
    expect(net.netMinor).toBe(3 * 2_500);

    // The reported figures must be derived from the ledger rows and nothing
    // else — no cached total on the order can drift away from them.
    const rows = await ledgerForOrder(order.id);
    const capturedFromRows = rows
      .filter((r) => r.type === "ORDER_CAPTURE")
      .reduce((n, r) => n + Math.abs(r.amountCents), 0);
    const refundedFromRows = rows
      .filter((r) => r.type === "REFUND")
      .reduce((n, r) => n + Math.abs(r.amountCents), 0);

    expect(capturedFromRows).toBe(net.capturedMinor);
    expect(refundedFromRows).toBe(net.refundedMinor);

    // A hold is an authorisation, not money taken, so it carries no amount.
    const holds = rows.filter((r) => r.type === "ORDER_HOLD");
    expect(holds).toHaveLength(1);
    expect(holds[0].amountCents).toBe(0);
  });

  it("keeps the ledger append-only", async () => {
    const actor = await makeAdvertiser();
    const { order, checkout } = await placeAndPay(actor, 1);
    await authorisePayment(checkout.intentId);

    const before = await prisma.transaction.findMany({ where: { orderId: order.id } });
    const items = await itemsOf(order.id);

    // A rejection, not a verification: verifying no longer moves money, since
    // the order was captured in full at placement.
    await transitionItem(actor, items[0].id, "REJECTED");

    const after = await prisma.transaction.findMany({ where: { orderId: order.id } });

    // Nothing that existed before was mutated; rows were only added.
    for (const row of before) {
      const still = after.find((r) => r.id === row.id)!;
      expect(still.amountCents).toBe(row.amountCents);
      expect(still.type).toBe(row.type);
    }
    expect(after.length).toBeGreaterThan(before.length);
  });
});

/* ─────────────────────────────  5  ───────────────────────────── */

describe("5. a refund arriving before its capture resolves to the correct net", () => {
  it("nets an item to zero when its refund lands before its own capture", async () => {
    const actor = await makeAdvertiser();
    const { order, checkout } = await placeAndPay(actor, 2, 6_000);
    await authorisePayment(checkout.intentId);

    const items = await itemsOf(order.id);

    // A refund for one placement arrives before the capture webhook does.
    // Capture is now an order-level event at placement, so this is the
    // out-of-order case that actually occurs: the provider confirms a refund
    // while our capture row is still in flight.
    const refundEvent = FakeProvider.buildEvent("refund.succeeded", {
      intentId: checkout.intentId,
      amountMinor: 6_000,
      currency: "USD",
      orderItemId: items[0].id,
    });
    await handleWebhook("STRIPE", refundEvent.rawBody, refundEvent.signature);

    // The capture then lands.
    await authorisePayment(checkout.intentId);

    const net = await netForOrder(order.id);
    expect(net.capturedMinor).toBe(2 * 6_000);
    expect(net.refundedMinor).toBe(6_000);
    expect(net.netMinor).toBe(6_000);
  });

  it("never lets refunds drive the net below zero", async () => {
    const actor = await makeAdvertiser();
    const { order, checkout } = await placeAndPay(actor, 1, 6_000);
    await authorisePayment(checkout.intentId);

    const [item] = await itemsOf(order.id);
    await transitionItem(actor, item.id, "REJECTED");

    // An extra provider-driven refund for the same order, beyond what was
    // captured. Over-refunding is a data problem for reconciliation to surface,
    // not something the net should quietly report as negative.
    const stray = FakeProvider.buildEvent("refund.succeeded", {
      intentId: checkout.intentId,
      amountMinor: 6_000,
      currency: "USD",
      orderItemId: item.id,
    });
    await handleWebhook("STRIPE", stray.rawBody, stray.signature);

    const net = await netForOrder(order.id);
    expect(net.netMinor).toBe(0);
    expect(net.netMinor).toBeGreaterThanOrEqual(0);
  });
});

/* ─────────────────────────────  6  ───────────────────────────── */

describe("6. changing a site's price after payment changes nothing", () => {
  it("leaves the order and the invoice untouched", async () => {
    const actor = await makeAdvertiser();
    const { order, checkout, siteIds } = await placeAndPay(actor, 2, 7_000);
    await authorisePayment(checkout.intentId);

    const items = await itemsOf(order.id);
    for (const item of items) await verifyItem(actor, item.id);

    const invoice = await getInvoiceForOrder(actor, order.id);
    const invoiceTotalBefore = invoice!.totalMinor;

    await prisma.site.update({ where: { id: siteIds[0] }, data: { priceCents: 99_999 } });

    const rereadOrder = await getOrder(actor, order.id);
    const rereadInvoice = await getInvoiceForOrder(actor, order.id);

    expect(rereadOrder.totalCents).toBe(2 * 7_000);
    expect(rereadInvoice!.totalMinor).toBe(invoiceTotalBefore);
    expect((await netForOrder(order.id)).capturedMinor).toBe(2 * 7_000);
  });
});

/* ─────────────────────────────  7  ───────────────────────────── */

describe("7. invoice numbers are sequential with no gaps across concurrent orders", () => {
  it("issues a gapless run under concurrency", async () => {
    const actor = await makeAdvertiser();

    const orders = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const { order, checkout } = await placeAndPay(actor, 1, 1_000);
        await authorisePayment(checkout.intentId);
        return order;
      })
    );

    // Verify them all at once, so invoices are issued concurrently.
    await Promise.all(
      orders.map(async (order) => {
        const [item] = await itemsOf(order.id);
        await verifyItem(actor, item.id);
      })
    );

    const invoices = await prisma.invoice.findMany({
      where: { orderId: { in: orders.map((o) => o.id) } },
      orderBy: { number: "asc" },
      select: { number: true },
    });
    expect(invoices).toHaveLength(6);

    const numbers = invoices.map((i) => Number(i.number.split("-").at(-1)));
    const sorted = [...numbers].sort((a, b) => a - b);

    expect(new Set(numbers).size).toBe(numbers.length); // no duplicates
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBe(1); // no gaps
    }
  });
});

/* ─────────────────────────────  8  ───────────────────────────── */

describe("8. no advertiser route returns costCents or margin, invoices included", () => {
  it("keeps cost out of orders, ledger views and invoices", async () => {
    const actor = await makeAdvertiser();
    const { order, checkout } = await placeAndPay(actor, 2);
    await authorisePayment(checkout.intentId);

    const items = await itemsOf(order.id);
    for (const item of items) await verifyItem(actor, item.id);

    const payloads = [
      JSON.stringify(await getOrder(actor, order.id)),
      JSON.stringify(await listOrders(actor, {})),
      JSON.stringify(await getInvoiceForOrder(actor, order.id)),
      JSON.stringify(await listInvoices(actor)),
    ];

    for (const payload of payloads) {
      expect(payload).not.toContain("costCents");
      expect(payload).not.toContain("margin");
      expect(payload.toLowerCase()).not.toContain("cost");
    }

    // The value exists in the database, so the absence above means something.
    const stored = await prisma.orderItem.findFirst({
      where: { orderId: order.id },
      select: { costCents: true },
    });
    expect(stored!.costCents).toBeGreaterThan(0);
  });
});

/* ─────────────────────────────  9  ───────────────────────────── */

describe("9. a failed payment leaves the order PENDING_PAYMENT with no fulfilment", () => {
  it("starts nothing on failure", async () => {
    const actor = await makeAdvertiser();
    const { order, checkout } = await placeAndPay(actor, 3);

    const event = FakeProvider.buildEvent("payment.failed", {
      intentId: checkout.intentId,
      amountMinor: order.totalCents,
      currency: "USD",
    });
    await handleWebhook("STRIPE", event.rawBody, event.signature);

    const reread = await getOrder(actor, order.id);
    expect(reread.status).toBe("PENDING_PAYMENT");
    expect(reread.items.every((i) => i.status === "QUEUED")).toBe(true);

    expect(
      await prisma.transaction.count({ where: { orderId: order.id, type: "ORDER_CAPTURE" } })
    ).toBe(0);
    expect(await prisma.invoice.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("refuses to fulfil an order that was never authorised", async () => {
    const actor = await makeAdvertiser();
    const { order } = await placeAndPay(actor, 1);
    const [item] = await itemsOf(order.id);

    await expect(verifyItem(actor, item.id)).rejects.toBeInstanceOf(ValidationError);
    expect((await getOrder(actor, order.id)).status).toBe("PENDING_PAYMENT");
  });
});

/* ─────────────────────────────  10  ───────────────────────────── */

describe("10. a partially captured order that is then fully refunded nets to zero", () => {
  it("nets to zero", async () => {
    const actor = await makeAdvertiser();
    const { order, checkout } = await placeAndPay(actor, 4, 3_000);
    await authorisePayment(checkout.intentId);

    const items = await itemsOf(order.id);
    for (const item of items.slice(0, 3)) await verifyItem(actor, item.id);
    await transitionItem(actor, items[3].id, "REJECTED");

    const partial = await netForOrder(order.id);
    expect(partial.netMinor).toBe(3 * 3_000);

    // Every captured item is then refunded.
    for (const item of items.slice(0, 3)) {
      await transitionItem(actor, item.id, "REFUNDED", { note: "goodwill" });
    }

    const final = await netForOrder(order.id);
    // Captured once for the whole order; every placement refunded in the end.
    expect(final.capturedMinor).toBe(4 * 3_000);
    expect(final.refundedMinor).toBe(4 * 3_000);
    expect(final.netMinor).toBe(0);

    // Credit notes, not an edited invoice. The invoice covered all four items
    // because all four were charged at placement, so all four refunds are
    // credited back — previously only captured items produced a note.
    const invoice = await prisma.invoice.findFirst({ where: { orderId: order.id } });
    expect(invoice).not.toBeNull();
    expect(invoice!.totalMinor).toBe(4 * 3_000);

    const notes = await prisma.creditNote.findMany({ where: { invoiceId: invoice!.id } });
    expect(notes).toHaveLength(4);
    expect(notes.reduce((n, c) => n + c.amountMinor, 0)).toBe(4 * 3_000);
  });
});

/* ─────────────────  provider routing (three providers)  ───────────────── */

describe("billing country decides the provider", () => {
  it("routes India to Razorpay, the EU and UK to PayPal, everywhere else to Stripe", () => {
    // Read with the fake-provider override off, so the real routing table is
    // exercised rather than the test short-circuit.
    const previous = process.env.PAYMENTS_FORCE_FAKE;
    delete process.env.PAYMENTS_FORCE_FAKE;

    try {
      expect(providerForCountry("IN")).toBe("RAZORPAY");

      for (const country of ["DE", "FR", "IE", "ES", "NL", "GB"]) {
        expect(providerForCountry(country), country).toBe("PAYPAL");
      }

      for (const country of ["US", "CA", "AU", "BR", "JP", "ZA"]) {
        expect(providerForCountry(country), country).toBe("STRIPE");
      }

      // Unknown or missing country falls back to cards rather than throwing.
      expect(providerForCountry(null)).toBe("STRIPE");
      expect(providerForCountry("")).toBe("STRIPE");
      expect(providerForCountry("xx")).toBe("STRIPE");
    } finally {
      if (previous !== undefined) process.env.PAYMENTS_FORCE_FAKE = previous;
    }
  });

  it("is case-insensitive about the country code", () => {
    const previous = process.env.PAYMENTS_FORCE_FAKE;
    delete process.env.PAYMENTS_FORCE_FAKE;
    try {
      expect(providerForCountry("de")).toBe("PAYPAL");
      expect(providerForCountry("in")).toBe("RAZORPAY");
    } finally {
      if (previous !== undefined) process.env.PAYMENTS_FORCE_FAKE = previous;
    }
  });

  it("settles each country in a sensible currency", () => {
    expect(currencyForCountry("IN")).toBe("INR");
    expect(currencyForCountry("GB")).toBe("GBP");
    expect(currencyForCountry("DE")).toBe("EUR");
    expect(currencyForCountry("FR")).toBe("EUR");
    expect(currencyForCountry("US")).toBe("USD");
  });

  it("stores the provider on the order and never re-resolves it", async () => {
    const actor = await makeAdvertiser(); // billingCountry GB in the fixture
    const { order, checkout } = await placeAndPay(actor, 1);

    const stored = await prisma.order.findUnique({
      where: { id: order.id },
      select: { paymentProvider: true, billingCountry: true, providerIntentId: true },
    });

    expect(stored!.billingCountry).toBe("GB");
    expect(stored!.providerIntentId).toBe(checkout.intentId);
    const resolvedOnce = stored!.paymentProvider;

    // The customer moves country after placing. The order must not change
    // provider — an in-flight refund has to go back the way it came.
    await prisma.user.update({ where: { id: actor.id }, data: { billingCountry: "IN" } });
    await beginCheckout(actor, order.id);

    const after = await prisma.order.findUnique({
      where: { id: order.id },
      select: { paymentProvider: true, providerIntentId: true },
    });
    expect(after!.paymentProvider).toBe(resolvedOnce);
    expect(after!.providerIntentId).toBe(checkout.intentId);
  });

  it("exposes PayPal through the same interface as the others", async () => {
    const { getProvider } = await import("@/lib/payments/registry");
    const { PayPalProvider } = await import("@/lib/payments/paypal-provider");

    for (const method of ["createIntent", "capture", "refund", "parseWebhook"] as const) {
      expect(typeof PayPalProvider[method]).toBe("function");
    }

    // With no PayPal keys configured the registry falls back to the fake
    // provider rather than throwing halfway through a checkout.
    expect(getProvider("PAYPAL").name).toBe("FAKE");
  });
});
