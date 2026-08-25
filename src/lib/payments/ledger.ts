import type { Prisma, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/data/actor";

/**
 * The ledger. Append-only: there is no update or delete in this module, and
 * nothing else may write to Transaction.
 *
 * Sign convention, from the advertiser's side:
 *   ORDER_HOLD      0  — authorisation, not money moved
 *   ORDER_CAPTURE  -n  — money taken
 *   REFUND         +n  — money returned
 *   ADJUSTMENT    +/-n — a correction, with a reason and an actor
 *
 * Holds are recorded at zero because an authorisation is not a charge. The
 * authorised amount lives on the order, and a hold row that carried it would
 * double-count against captures when summing.
 */

export type LedgerEntryInput = {
  userId: string;
  type: TransactionType;
  /** Unsigned magnitude; the sign is applied here from the type. */
  amountMinor: number;
  currency: string;
  orderId?: string | null;
  orderItemId?: string | null;
  providerRef?: string | null;
  providerEventId?: string | null;
  actorUserId?: string | null;
  reason?: string | null;
};

/** Every user has a wallet row purely as their ledger account. */
async function walletFor(tx: Prisma.TransactionClient, userId: string): Promise<string> {
  const existing = await tx.wallet.findUnique({ where: { userId }, select: { id: true } });
  if (existing) return existing.id;

  const created = await tx.wallet.create({
    data: { userId },
    select: { id: true },
  });
  return created.id;
}

function signedAmount(type: TransactionType, magnitude: number): number {
  switch (type) {
    case "ORDER_HOLD":
      return 0;
    case "ORDER_CAPTURE":
      return -Math.abs(magnitude);
    case "REFUND":
      return Math.abs(magnitude);
    case "TOP_UP":
      return Math.abs(magnitude);
    case "ADJUSTMENT":
      return magnitude; // caller supplies the sign deliberately
  }
}

export async function appendLedgerEntry(
  tx: Prisma.TransactionClient,
  input: LedgerEntryInput
) {
  if (!Number.isInteger(input.amountMinor)) {
    throw new ValidationError("Ledger amounts must be integer minor units.");
  }
  if (!input.currency) {
    throw new ValidationError("Every ledger row must carry its currency.");
  }
  if (input.type === "ADJUSTMENT" && !input.reason?.trim()) {
    throw new ValidationError("An ADJUSTMENT must carry a reason.");
  }

  const walletId = await walletFor(tx, input.userId);

  return tx.transaction.create({
    data: {
      walletId,
      type: input.type,
      amountCents: signedAmount(input.type, input.amountMinor),
      currency: input.currency,
      orderId: input.orderId ?? null,
      orderItemId: input.orderItemId ?? null,
      providerRef: input.providerRef ?? null,
      providerEventId: input.providerEventId ?? null,
      actorUserId: input.actorUserId ?? null,
      reason: input.reason ?? null,
    },
  });
}

/**
 * Records a correction. The only way to fix a ledger mistake — the original row
 * is never touched.
 */
export async function recordAdjustment(input: {
  userId: string;
  orderId: string;
  signedAmountMinor: number;
  currency: string;
  reason: string;
  actorUserId: string;
}) {
  return prisma.$transaction((tx) =>
    appendLedgerEntry(tx, {
      userId: input.userId,
      type: "ADJUSTMENT",
      amountMinor: input.signedAmountMinor,
      currency: input.currency,
      orderId: input.orderId,
      reason: input.reason,
      actorUserId: input.actorUserId,
    })
  );
}

export async function ledgerForOrder(orderId: string) {
  return prisma.transaction.findMany({
    where: { orderId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      type: true,
      amountCents: true,
      currency: true,
      orderItemId: true,
      providerRef: true,
      providerEventId: true,
      reason: true,
      createdAt: true,
    },
  });
}

export type OrderNet = {
  currency: string;
  capturedMinor: number;
  refundedMinor: number;
  adjustmentMinor: number;
  /** What the advertiser has actually been charged, net of everything. */
  netMinor: number;
};

export async function netForOrder(orderId: string): Promise<OrderNet> {
  const rows = await prisma.transaction.findMany({
    where: { orderId },
    select: { type: true, amountCents: true, currency: true, orderItemId: true },
  });

  const currency = rows.find((r) => r.currency)?.currency ?? "USD";

  const capturedMinor = rows
    .filter((r) => r.type === "ORDER_CAPTURE")
    .reduce((n, r) => n + Math.abs(r.amountCents), 0);

  const refundedMinor = rows
    .filter((r) => r.type === "REFUND")
    .reduce((n, r) => n + Math.abs(r.amountCents), 0);

  const adjustmentMinor = rows
    .filter((r) => r.type === "ADJUSTMENT")
    .reduce((n, r) => n + r.amountCents, 0);

  /*
   * Net is what the advertiser has actually been charged.
   *
   * Under the current model the whole order is captured once at placement, and
   * every failed placement is refunded individually — so a refund always
   * reverses money that was genuinely taken, and gross subtraction is correct.
   *
   * This used to be computed per item, capping each item's refund at what had
   * been captured for that item. That was necessary when capture happened per
   * item on verification: a rejected placement was refunded against an
   * authorisation that had never been captured, so counting it would have
   * under-reported revenue. With order-level capture that case cannot arise.
   *
   * Floored at zero: refunding more than was captured is a data problem, and
   * reconciliation should surface it rather than the net quietly going negative.
   */
  const netMinor = Math.max(0, capturedMinor - refundedMinor - adjustmentMinor);

  return {
    currency,
    capturedMinor,
    refundedMinor,
    adjustmentMinor,
    netMinor,
  };
}

/**
 * The nightly reconciliation check. Compares our ledger against what the
 * provider reports as settled for each order, and returns the mismatches for a
 * human — silent drift here is how a six-figure hole is found a year late.
 */
export async function reconcileOrders(
  providerNetByOrder: Map<string, number>
): Promise<{ orderId: string; ledgerMinor: number; providerMinor: number; deltaMinor: number }[]> {
  const mismatches = [];

  for (const [orderId, providerMinor] of providerNetByOrder) {
    const { netMinor } = await netForOrder(orderId);
    if (netMinor !== providerMinor) {
      mismatches.push({
        orderId,
        ledgerMinor: netMinor,
        providerMinor,
        deltaMinor: netMinor - providerMinor,
      });
    }
  }

  return mismatches;
}
