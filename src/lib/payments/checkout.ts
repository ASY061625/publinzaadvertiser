import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError, type Actor } from "@/lib/data/actor";
import { appendLedgerEntry } from "./ledger";
import { getProvider } from "./registry";
import { currencyForCountry, providerForCountry } from "./types";

/**
 * Pay-per-order checkout. One payment authorises one order; there is no stored
 * balance and no top-up flow.
 *
 * DRAFT/IN_PROGRESS → PENDING_PAYMENT → (webhook) → IN_PROGRESS
 */

export type CheckoutHandle = {
  orderId: string;
  intentId: string;
  clientSecret: string;
  provider: string;
  amountMinor: number;
  currency: string;
};

/**
 * Creates the payment intent and moves the order to PENDING_PAYMENT.
 *
 * Idempotent: calling it again for an order that already has an intent returns
 * the same one rather than authorising a second time.
 */
export async function beginCheckout(actor: Actor, orderId: string): Promise<CheckoutHandle> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: actor.id },
    select: {
      id: true,
      status: true,
      totalCents: true,
      currency: true,
      providerIntentId: true,
      paymentProvider: true,
      billingCountry: true,
      items: { select: { id: true } },
      user: { select: { billingCountry: true, country: true } },
    },
  });
  if (!order) throw new NotFoundError();

  if (order.items.length === 0) {
    throw new ValidationError("An order needs at least one item before it can be paid for.");
  }

  if (order.providerIntentId) {
    return {
      orderId: order.id,
      intentId: order.providerIntentId,
      clientSecret: `${order.providerIntentId}_secret`,
      provider: order.paymentProvider ?? "FAKE",
      amountMinor: order.totalCents,
      currency: order.currency,
    };
  }

  // Resolved once, here, and stored. Never re-resolved: a customer who moves
  // country must not break an in-flight refund.
  const billingCountry = order.billingCountry ?? order.user.billingCountry ?? order.user.country ?? null;
  const providerName = providerForCountry(billingCountry);
  const currency = order.currency || currencyForCountry(billingCountry);

  const provider = getProvider(providerName);
  const intent = await provider.createIntent({
    orderId: order.id,
    amountMinor: order.totalCents,
    currency,
    customerRef: actor.id,
  });

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PENDING_PAYMENT",
        billingCountry,
        paymentProvider: providerName,
        providerIntentId: intent.intentId,
        currency,
      },
    });

    // The hold records the authorisation. It carries no amount, because an
    // authorisation is not money taken — see the sign convention in ledger.ts.
    await appendLedgerEntry(tx, {
      userId: actor.id,
      type: "ORDER_HOLD",
      amountMinor: 0,
      currency,
      orderId: order.id,
      providerRef: intent.intentId,
      actorUserId: actor.id,
    });
  });

  return {
    orderId: order.id,
    intentId: intent.intentId,
    clientSecret: intent.clientSecret,
    provider: providerName,
    amountMinor: order.totalCents,
    currency,
  };
}

/**
 * Test and local-development helper: marks an intent authorised without a real
 * webhook. Production authorisation always arrives through handleWebhook.
 */
export async function authorisePayment(intentId: string): Promise<void> {
  const order = await prisma.order.findFirst({
    where: { providerIntentId: intentId },
    select: { id: true, status: true },
  });
  if (!order) throw new NotFoundError();

  if (order.status === "PENDING_PAYMENT") {
    await prisma.order.update({ where: { id: order.id }, data: { status: "IN_PROGRESS" } });
  }

  // Capture the whole order, exactly as the webhook path does, so the local
  // helper and production behave identically.
  const { captureOrder } = await import("./settlement");
  await captureOrder(order.id);
}

/** True once the order's payment is authorised and fulfilment may begin. */
export async function isAuthorised(orderId: string): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, providerIntentId: true },
  });
  if (!order) return false;

  // An order that never entered checkout has no intent and cannot be fulfilled.
  if (!order.providerIntentId) return false;
  return order.status !== "PENDING_PAYMENT" && order.status !== "DRAFT";
}
