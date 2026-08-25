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
 * Stripe adapter.
 *
 * Deliberately talks to the REST API over fetch rather than pulling in the SDK:
 * the surface used here is four calls, and this keeps the dependency (and its
 * install script) out of the project. Card data never reaches this code — the
 * client uses Stripe's hosted fields with the client secret returned below.
 *
 * Configure with STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. Without them the
 * registry falls back to the fake provider.
 */

const API = "https://api.stripe.com/v1";

function secretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY || null;
}

function webhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET || null;
}

export class StripeError extends Error {}
export class StripeSignatureError extends Error {}

async function call(path: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const key = secretKey();
  if (!key) throw new StripeError("STRIPE_SECRET_KEY is not configured.");

  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });

  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      (json.error as { message?: string } | undefined)?.message ?? `Stripe returned ${res.status}`;
    throw new StripeError(message);
  }
  return json;
}

const EVENT_MAP: Record<string, ProviderEventType> = {
  "payment_intent.amount_capturable_updated": "payment.authorised",
  "payment_intent.succeeded": "payment.captured",
  "payment_intent.payment_failed": "payment.failed",
  "charge.refunded": "refund.succeeded",
};

export const StripeProvider: PaymentProvider & { isConfigured: () => boolean } = {
  name: "STRIPE",

  isConfigured: () => !!secretKey() && !!webhookSecret(),

  async createIntent(args: CreateIntentArgs): Promise<CreatedIntent> {
    // manual capture: the authorisation is held, and each verified item is
    // captured separately against it.
    const intent = await call("/payment_intents", {
      amount: String(args.amountMinor),
      currency: args.currency.toLowerCase(),
      capture_method: "manual",
      "metadata[orderId]": args.orderId,
      "metadata[customerRef]": args.customerRef,
    });

    return {
      intentId: String(intent.id),
      clientSecret: String(intent.client_secret),
    };
  },

  async capture(intentId: string, amountMinor: number): Promise<void> {
    await call(`/payment_intents/${intentId}/capture`, {
      amount_to_capture: String(amountMinor),
    });
  },

  async refund(intentId: string, amountMinor: number, reason: string): Promise<RefundResult> {
    const refund = await call("/refunds", {
      payment_intent: intentId,
      amount: String(amountMinor),
      "metadata[reason]": reason,
    });
    return { refundId: String(refund.id) };
  },

  async parseWebhook(rawBody: Buffer, signature: string): Promise<ProviderEvent> {
    const secret = webhookSecret();
    if (!secret) throw new StripeError("STRIPE_WEBHOOK_SECRET is not configured.");

    // Verify before parsing. Stripe signs "<timestamp>.<body>".
    const parts = Object.fromEntries(
      (signature ?? "").split(",").map((p) => {
        const [k, ...rest] = p.split("=");
        return [k.trim(), rest.join("=")];
      })
    );
    const timestamp = parts.t;
    const supplied = parts.v1;
    if (!timestamp || !supplied) throw new StripeSignatureError("Malformed Stripe signature header.");

    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody.toString("utf8")}`)
      .digest("hex");

    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(supplied, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new StripeSignatureError("Stripe signature does not match the request body.");
    }

    const parsed = JSON.parse(rawBody.toString("utf8"));
    const object = parsed?.data?.object ?? {};

    return {
      eventId: String(parsed.id),
      type: EVENT_MAP[String(parsed.type)] ?? "unknown",
      intentId: String(object.payment_intent ?? object.id ?? ""),
      reportedAmountMinor:
        typeof object.amount_received === "number"
          ? object.amount_received
          : typeof object.amount === "number"
            ? object.amount
            : null,
      reportedCurrency: object.currency ? String(object.currency).toUpperCase() : null,
      orderItemId: object.metadata?.orderItemId ?? null,
      raw: parsed,
    };
  },
};
