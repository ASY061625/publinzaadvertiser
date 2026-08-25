import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { getProvider } from "./registry";
import { captureOrder, refundItem } from "./settlement";
import type { ProviderEvent, ProviderName } from "./types";

export class WebhookSignatureError extends Error {
  constructor(message = "Webhook signature verification failed.") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

export type WebhookResult = {
  ok: true;
  duplicate: boolean;
  eventId: string | null;
  handled: string;
};

/**
 * The webhook entry point.
 *
 * Order of operations matters and is deliberate:
 *   1. Verify the signature, before the body is parsed at all. An unsigned
 *      webhook is an attacker telling you they paid.
 *   2. Claim the event id. The unique constraint on (provider, eventId) is what
 *      makes replay a no-op — providers retry aggressively and will duplicate.
 *   3. Only then act.
 *
 * Amounts in the body are recorded for reconciliation and never trusted over
 * our own stored amounts. Events arrive out of order, so each handler is
 * written to tolerate having already happened, or not yet having happened.
 */
export async function handleWebhook(
  providerName: ProviderName | string,
  rawBody: Buffer,
  signature: string
): Promise<WebhookResult> {
  const provider = getProvider(providerName);

  let event: ProviderEvent;
  try {
    event = await provider.parseWebhook(rawBody, signature);
  } catch (err) {
    // Any verification failure is a signature failure to the caller — a
    // malformed body behind a bad signature must not look like a parse bug.
    throw new WebhookSignatureError(
      err instanceof Error ? err.message : "Webhook signature verification failed."
    );
  }

  const order = event.intentId
    ? await prisma.order.findFirst({
        where: { providerIntentId: event.intentId },
        select: { id: true, userId: true, status: true, currency: true },
      })
    : null;

  // Claim the event before doing anything. A duplicate loses the race here and
  // returns without side effects.
  try {
    await prisma.processedWebhookEvent.create({
      data: {
        provider: String(providerName),
        providerEventId: event.eventId,
        eventType: event.type,
        orderId: order?.id ?? null,
        payloadDigest: createHash("sha256").update(rawBody).digest("hex"),
      },
    });
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      return { ok: true, duplicate: true, eventId: event.eventId, handled: "duplicate" };
    }
    throw err;
  }

  let handled = "ignored";

  if (order) {
    switch (event.type) {
      case "payment.authorised":
      case "payment.captured": {
        // Tolerates an order already marked paid: out-of-order delivery means
        // this can arrive after fulfilment has begun.
        if (order.status === "PENDING_PAYMENT") {
          await prisma.order.update({
            where: { id: order.id },
            data: { status: "IN_PROGRESS" },
          });
        }

        // The whole order is captured here, at placement, rather than per item
        // on verification. captureOrder is idempotent, so a duplicate or
        // out-of-order delivery adds nothing.
        await captureOrder(order.id, { providerEventId: event.eventId });

        handled = "captured";
        break;
      }

      case "payment.failed": {
        // Leaves the order in PENDING_PAYMENT with no fulfilment started.
        handled = "failed";
        break;
      }

      case "refund.succeeded": {
        // A refund can arrive before the capture it reverses. refundItem is
        // idempotent and does not require a prior capture row.
        if (event.orderItemId) {
          await refundItem(event.orderItemId, "Provider refund", {
            providerEventId: event.eventId,
          });
        }
        handled = "refunded";
        break;
      }

      default:
        handled = "ignored";
    }
  }

  await prisma.processedWebhookEvent.updateMany({
    where: { provider: String(providerName), providerEventId: event.eventId },
    data: { processedAt: new Date() },
  });

  return { ok: true, duplicate: false, eventId: event.eventId, handled };
}
