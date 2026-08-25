import type { ItemStatus, OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError, isStaff, type Actor } from "./actor";
import { publisherForItem, recomputeAndStore } from "./reliability";

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionError";
  }
}

/**
 * The single source of truth for the item lifecycle, straight from PHASE3.md.
 * Anything not listed here throws. No route handler may assign `status`
 * directly — every change goes through transitionItem below.
 */
export const ALLOWED_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  QUEUED: ["CONTENT_PENDING", "SUBMITTED_TO_PUBLISHER", "REJECTED"],
  CONTENT_PENDING: ["SUBMITTED_TO_PUBLISHER", "REJECTED"],
  SUBMITTED_TO_PUBLISHER: ["PUBLISHED", "REVISION_REQUESTED", "REJECTED"],
  REVISION_REQUESTED: ["SUBMITTED_TO_PUBLISHER", "REJECTED"],
  PUBLISHED: ["VERIFIED", "REVISION_REQUESTED"],
  VERIFIED: ["REFUNDED"],
  REJECTED: [],
  REFUNDED: [],
};

/**
 * Statuses an item can no longer move on from for order-status purposes.
 *
 * VERIFIED is counted as terminal here even though VERIFIED → REFUNDED exists:
 * a verified placement is a delivered one, and an order of verified items must
 * read COMPLETE rather than sitting at IN_PROGRESS forever waiting on a refund
 * that will probably never come.
 */
const TERMINAL: ItemStatus[] = ["VERIFIED", "REJECTED", "REFUNDED"];

/**
 * Moves that represent doing the work. These require an authorised payment;
 * REJECTED and REFUNDED do not, so a failed order can still be cancelled.
 */
const FULFILMENT_STATUSES: ItemStatus[] = [
  "CONTENT_PENDING",
  "SUBMITTED_TO_PUBLISHER",
  "REVISION_REQUESTED",
  "PUBLISHED",
  "VERIFIED",
];

export function isTerminal(status: ItemStatus): boolean {
  return TERMINAL.includes(status);
}

/**
 * Derives the parent order's status from its items. The Order.status column is
 * only ever written from this — never set directly.
 *
 * PHASE3.md lists "all terminal, some VERIFIED → COMPLETE" alongside
 * "mixed → PARTIALLY_COMPLETE", which overlap. Resolved as: all terminal and
 * *every* item verified is COMPLETE; all terminal with a mix of verified and
 * not is PARTIALLY_COMPLETE. That matches acceptance test 6, which expects
 * three distinct outcomes for all-verified, all-rejected and mixed.
 */
export function deriveOrderStatus(statuses: ItemStatus[]): OrderStatus {
  if (statuses.length === 0) return "DRAFT";
  if (statuses.some((s) => !isTerminal(s))) return "IN_PROGRESS";

  const verified = statuses.filter((s) => s === "VERIFIED").length;
  if (verified === statuses.length) return "COMPLETE";
  if (verified === 0) return "CANCELLED";
  return "PARTIALLY_COMPLETE";
}

function assertPublishedUrl(url: string | undefined | null): string {
  const trimmed = url?.trim() ?? "";
  if (!trimmed) throw new ValidationError("A published URL is required to mark an item PUBLISHED.");

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ValidationError("The published URL must be a valid absolute URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError("The published URL must be an http or https URL.");
  }
  return parsed.toString();
}

/** Recomputes and stores the parent order's status. Call inside the transaction. */
async function syncOrderStatus(tx: Prisma.TransactionClient, orderId: string): Promise<OrderStatus> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { status: true, items: { select: { status: true } } },
  });
  if (!order) return "DRAFT";

  const derived = deriveOrderStatus(order.items.map((i) => i.status));

  // An unpaid order must not be promoted to IN_PROGRESS by an item moving.
  // Only the payment authorisation lifts PENDING_PAYMENT. It may still reach a
  // terminal status, because cancelling an unpaid order is allowed.
  if (order.status === "PENDING_PAYMENT" && derived === "IN_PROGRESS") {
    return "PENDING_PAYMENT";
  }

  await tx.order.update({ where: { id: orderId }, data: { status: derived } });
  return derived;
}

export type TransitionOptions = {
  note?: string | null;
  publishedUrl?: string | null;
  /** Set on assignment by staff; ignored for advertisers. */
  assignedToId?: string | null;
};

/**
 * The one function that changes an item's status.
 *
 * Scoping: staff may drive any item; an advertiser may only drive their own,
 * and only along the transitions they are allowed to make (cancelling a queued
 * item). The status change, the audit row and the parent order's recomputed
 * status all happen in one transaction, so history can never disagree with
 * state.
 */
export async function transitionItem(
  actor: Actor,
  orderItemId: string,
  to: ItemStatus,
  options: TransitionOptions = {}
) {
  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.findFirst({
      where: isStaff(actor)
        ? { id: orderItemId }
        : // Ownership is part of the lookup, so another user's item is simply
          // not found rather than raising a distinguishable "forbidden".
          { id: orderItemId, order: { userId: actor.id } },
      select: { id: true, status: true, orderId: true },
    });
    if (!item) throw new NotFoundError();

    // Fulfilment cannot begin on an order whose payment was never authorised.
    // Cancelling and refusing are still allowed — those need no money.
    if (FULFILMENT_STATUSES.includes(to)) {
      const order = await tx.order.findUnique({
        where: { id: item.orderId },
        select: { status: true, providerIntentId: true },
      });
      const authorised =
        !!order &&
        // An order placed before Phase 5 has no intent; those are grandfathered
        // rather than becoming unfulfillable.
        (order.providerIntentId === null
          ? order.status !== "PENDING_PAYMENT"
          : order.status !== "PENDING_PAYMENT" && order.status !== "DRAFT");

      if (!authorised) {
        throw new ValidationError(
          "This order's payment has not been authorised yet, so fulfilment cannot start."
        );
      }
    }

    const allowed = ALLOWED_TRANSITIONS[item.status] ?? [];
    if (!allowed.includes(to)) {
      throw new TransitionError(
        `Cannot move an item from ${item.status} to ${to}. Allowed: ${
          allowed.length ? allowed.join(", ") : "none, this status is terminal"
        }.`
      );
    }

    const data: Prisma.OrderItemUpdateInput = { status: to };

    if (to === "PUBLISHED") {
      data.publishedUrl = assertPublishedUrl(options.publishedUrl);
      data.publishedAt = new Date();
    }
    if (options.assignedToId !== undefined && isStaff(actor)) {
      data.assignedTo = options.assignedToId
        ? { connect: { id: options.assignedToId } }
        : { disconnect: true };
    }

    const updated = await tx.orderItem.update({ where: { id: item.id }, data });

    // Exactly one audit row per accepted change, written in the same
    // transaction — a refused transition throws before reaching this.
    await tx.itemStatusEvent.create({
      data: {
        orderItemId: item.id,
        fromStatus: item.status,
        toStatus: to,
        actorUserId: actor.id,
        note: options.note?.trim() || null,
      },
    });

    const orderStatus = await syncOrderStatus(tx, item.orderId);
    return { item: updated, orderStatus };
  });

  // Money moves after the transaction commits. Capture and refund call an
  // external provider, which must never hold a database transaction open, and a
  // provider failure must not roll back a status change that really happened —
  // reconciliation surfaces the mismatch instead.
  try {
    const { settleItemStatus } = await import("@/lib/payments/settlement");
    await settleItemStatus(orderItemId, to, options.note ?? null);
  } catch (err) {
    console.error("Settlement failed for item", orderItemId, err);
  }

  // Reliability is recomputed after the transaction commits, not inside it: it
  // reads the item's own history, and a score that failed to update must never
  // roll back the status change it was reacting to.
  const publisherId = await publisherForItem(orderItemId);
  if (publisherId) {
    try {
      await recomputeAndStore(publisherId);
    } catch (err) {
      console.error("Reliability recompute failed for publisher", publisherId, err);
    }
  }

  return result;
}

/** History for one item, scoped the same way as the item itself. */
export async function itemHistory(actor: Actor, orderItemId: string) {
  const item = await prisma.orderItem.findFirst({
    where: isStaff(actor)
      ? { id: orderItemId }
      : { id: orderItemId, order: { userId: actor.id } },
    select: { id: true },
  });
  if (!item) throw new NotFoundError();

  return prisma.itemStatusEvent.findMany({
    where: { orderItemId: item.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      actorUserId: true,
      note: true,
      createdAt: true,
    },
  });
}

export { syncOrderStatus };
