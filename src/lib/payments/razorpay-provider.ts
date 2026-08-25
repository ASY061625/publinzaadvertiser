import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CreateIntentArgs,
  CreatedIntent,
  PaymentProvider,
  ProviderEvent,
  ProviderEventType,
  RefundResult,
} from "./types";

/**
 * Razorpay adapter, used for Indian billing countries.
 *
 * Same shape as the Stripe adapter: REST over fetch, no SDK, card data never
 * reaches this code. Razorpay's "order" is the equivalent of an intent, and
 * capture is performed against the payment id that the checkout returns.
 *
 * Configure with RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and
 * RAZORPAY_WEBHOOK_SECRET.
 */

const API = "https://api.razorpay.com/v1";

function keyId() {
  return process.env.RAZORPAY_KEY_ID || null;
}
function keySecret() {
  return process.env.RAZORPAY_KEY_SECRET || null;
}
function webhookSecret() {
  return process.env.RAZORPAY_WEBHOOK_SECRET || null;
}

export class RazorpayError extends Error {}
export class RazorpaySignatureError extends Error {}

async function call(
  path: string,
  body: Record<string, unknown> | null,
  method: "POST" | "GET" = "POST"
): Promise<Record<string, unknown>> {
  const id = keyId();
  const secret = keySecret();
  if (!id || !secret) throw new RazorpayError("Razorpay keys are not configured.");

  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      ((json.error as { description?: string } | undefined)?.description ??
        `Razorpay returned ${res.status}`) as string;
    throw new RazorpayError(message);
  }
  return json;
}

const EVENT_MAP: Record<string, ProviderEventType> = {
  "payment.authorized": "payment.authorised",
  "payment.captured": "payment.captured",
  "payment.failed": "payment.failed",
  "refund.processed": "refund.succeeded",
};

export const RazorpayProvider: PaymentProvider & { isConfigured: () => boolean } = {
  name: "RAZORPAY",

  isConfigured: () => !!keyId() && !!keySecret() && !!webhookSecret(),

  async createIntent(args: CreateIntentArgs): Promise<CreatedIntent> {
    const order = await call("/orders", {
      amount: args.amountMinor,
      currency: args.currency.toUpperCase(),
      // Authorise now, capture per verified item later.
      payment_capture: 0,
      notes: { orderId: args.orderId, customerRef: args.customerRef },
    });

    return {
      intentId: String(order.id),
      // Razorpay's checkout takes the order id plus the public key; there is no
      // separate secret, so the id doubles as the client handle.
      clientSecret: String(order.id),
    };
  },

  async capture(intentId: string, amountMinor: number): Promise<void> {
    await call(`/payments/${intentId}/capture`, { amount: amountMinor, currency: "INR" });
  },

  async refund(intentId: string, amountMinor: number, reason: string): Promise<RefundResult> {
    const refund = await call(`/payments/${intentId}/refund`, {
      amount: amountMinor,
      notes: { reason },
    });
    return { refundId: String(refund.id) };
  },

  async parseWebhook(rawBody: Buffer, signature: string): Promise<ProviderEvent> {
    const secret = webhookSecret();
    if (!secret) throw new RazorpayError("RAZORPAY_WEBHOOK_SECRET is not configured.");

    // Verify before parsing: Razorpay signs the raw body with HMAC-SHA256.
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature ?? "", "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new RazorpaySignatureError("Razorpay signature does not match the request body.");
    }

    const parsed = JSON.parse(rawBody.toString("utf8"));
    const payment = parsed?.payload?.payment?.entity ?? {};
    const refund = parsed?.payload?.refund?.entity ?? {};
    const entity = Object.keys(refund).length > 0 ? refund : payment;

    return {
      eventId: String(parsed.id ?? entity.id),
      type: EVENT_MAP[String(parsed.event)] ?? "unknown",
      intentId: String(payment.order_id ?? entity.payment_id ?? entity.id ?? ""),
      reportedAmountMinor: typeof entity.amount === "number" ? entity.amount : null,
      reportedCurrency: entity.currency ? String(entity.currency).toUpperCase() : null,
      orderItemId: entity.notes?.orderItemId ?? null,
      raw: parsed,
    };
  },
};
