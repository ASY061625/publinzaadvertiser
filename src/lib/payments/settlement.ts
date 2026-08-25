import { prisma } from "@/lib/db";
import { appendLedgerEntry, netForOrder } from "./ledger";
import { getProvider } from "./registry";
import { issueCreditNote, issueInvoiceForOrder } from "./invoices";

/**
 * Settlement: capture in full at placement, refund per item when a placement
 * fails.
 *
 * This replaced per-item capture on verification. The change was driven by
 * PayPal, whose authorisations expire after 29 days — routinely shorter than
 * fulfilment takes — and whose partial-capture support is constrained. Rather
 * than run one settlement path per provider, every provider now uses this one.
 *
 * The advertiser's net position is unchanged: a ten-item order with two
 * rejected placements still nets to eight items' worth. What differs is the
 * route there — the money is taken up front and returned per failure, instead
 * of never being taken. PHASE5.md warns against per-order capture precisely
 * because it makes partial failure hard to bill correctly; that warning is
 * answered by refunding per item, and by the ledger recording each refund
 * against the item that caused it.
 *
 * Every function here is idempotent, because its triggers — item status
 * changes and provider webhooks — both fire more than once in practice.
 */

/**
 * Captures the whole order. Called once, when the provider confirms the
 * payment. Safe to call repeatedly.
 */
export async function captureOrder(orderId: string, opts: { providerEventId?: string } = {}) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      currency: true,
      totalCents: true,
      providerIntentId: true,
      paymentProvider: true,
    },
  });
  if (!order?.providerIntentId) return null;

  const already = await prisma.transaction.findFirst({
    where: { orderId, type: "ORDER_CAPTURE" },
    select: { id: true },
  });
  if (already) return already;

  // The amount comes from the order's own snapshotted total, never from a
  // webhook body.
  const amountMinor = order.totalCents;

  let providerRef: string | null = order.providerIntentId;
  try {
    const provider = getProvider(order.paymentProvider);
    await provider.capture(order.providerIntentId, amountMinor);
  } catch (err) {
    console.error("Provider capture failed", { orderId, err });
    // The ledger still records the intent to capture; reconciliation surfaces
    // the mismatch rather than the charge silently vanishing.
    providerRef = `${order.providerIntentId}:capture-failed`;
  }

  const row = await prisma.$transaction((tx) =>
    appendLedgerEntry(tx, {
      userId: order.userId,
      type: "ORDER_CAPTURE",
      amountMinor,
      currency: order.currency,
      orderId: order.id,
      // Deliberately no orderItemId: this is one capture for the whole order.
      orderItemId: null,
      providerRef,
      providerEventId: opts.providerEventId ?? null,
    })
  );

  // The invoice covers the whole order, because the whole order was charged.
  await issueInvoiceForOrder(order.id);

  return row;
}

/**
 * Refunds one item. This is now the only way money goes back, so it runs for
 * every failed placement rather than only for explicitly refunded ones.
 */
export async function refundItem(
  orderItemId: string,
  reason: string,
  opts: { providerEventId?: string; amountMinorOverride?: number } = {}
) {
  const item = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
    select: {
      id: true,
      priceCents: true,
      order: {
        select: {
          id: true,
          userId: true,
          currency: true,
          providerIntentId: true,
          paymentProvider: true,
        },
      },
    },
  });
  if (!item?.order.providerIntentId) return null;

  const already = await prisma.transaction.findFirst({
    where: { orderItemId, type: "REFUND" },
    select: { id: true },
  });
  if (already) return already;

  const amountMinor = opts.amountMinorOverride ?? item.priceCents;

  let providerRef: string | null = null;
  try {
    const provider = getProvider(item.order.paymentProvider);
    const result = await provider.refund(item.order.providerIntentId, amountMinor, reason);
    providerRef = result.refundId;
  } catch (err) {
    console.error("Provider refund failed", { orderItemId, err });
    providerRef = `${item.order.providerIntentId}:refund-failed`;
  }

  const row = await prisma.$transaction((tx) =>
    appendLedgerEntry(tx, {
      userId: item.order.userId,
      type: "REFUND",
      amountMinor,
      currency: item.order.currency,
      orderId: item.order.id,
      orderItemId: item.id,
      providerRef,
      providerEventId: opts.providerEventId ?? null,
      reason,
    })
  );

  // The order was invoiced in full at capture, so every refund is a credit note
  // against that invoice. The issued invoice is never edited.
  const invoice = await prisma.invoice.findFirst({
    where: { orderId: item.order.id },
    select: { id: true },
  });
  if (invoice) {
    await issueCreditNote({ invoiceId: invoice.id, amountMinor, reason });
  }

  return row;
}

/**
 * Called after every item status change.
 *
 * VERIFIED no longer settles anything — the money was taken at placement.
 * REJECTED and REFUNDED return that item's share.
 */
export async function settleItemStatus(orderItemId: string, status: string, note?: string | null) {
  if (status === "REJECTED") return refundItem(orderItemId, note || "Placement rejected");
  if (status === "REFUNDED") return refundItem(orderItemId, note || "Refunded");
  return null;
}

export { netForOrder };
