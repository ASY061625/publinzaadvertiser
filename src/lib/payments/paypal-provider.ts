import { createHash } from "node:crypto";
import type {
  CreateIntentArgs,
  CreatedIntent,
  PaymentProvider,
  ProviderEvent,
  ProviderEventType,
  RefundResult,
} from "./types";

/**
 * PayPal adapter, used for EU and UK billing countries.
 *
 * Same shape as the Stripe and Razorpay adapters: REST over fetch, no SDK, and
 * card data never reaches this code — the buyer approves the order in PayPal's
 * own flow and we only ever see an order id.
 *
 * PayPal's model differs from Stripe's in two ways that shaped the settlement
 * design:
 *
 *   1. An authorisation expires after 29 days, and honouring it after that is
 *      not guaranteed. Fulfilment routinely takes longer than that.
 *   2. Multiple partial captures against one authorisation are constrained.
 *
 * Both point the same way: capture the order in full at placement and refund
 * per item when a placement fails, rather than capturing per item on
 * verification. That model is now used for every provider, so there is one
 * settlement path rather than one per provider.
 *
 * Configure with PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and
 * PAYPAL_WEBHOOK_ID. Without them the registry falls back to the fake provider.
 */

function apiBase(): string {
  // Sandbox unless explicitly told otherwise, so a missing env var cannot
  // accidentally point at live.
  return process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function clientId() {
  return process.env.PAYPAL_CLIENT_ID || null;
}
function clientSecret() {
  return process.env.PAYPAL_CLIENT_SECRET || null;
}
function webhookId() {
  return process.env.PAYPAL_WEBHOOK_ID || null;
}

export class PayPalError extends Error {}
export class PayPalSignatureError extends Error {}

/** OAuth token, cached until shortly before it expires. */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) throw new PayPalError("PayPal credentials are not configured.");

  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) throw new PayPalError(`PayPal token request returned ${res.status}`);

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.value;
}

async function call(
  path: string,
  body: Record<string, unknown> | null,
  method: "POST" | "GET" = "POST"
): Promise<Record<string, unknown>> {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  // Capture and refund can legitimately answer 204 with no body.
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    const message =
      (json.message as string | undefined) ?? `PayPal returned ${res.status}`;
    throw new PayPalError(message);
  }
  return json;
}

/** Minor units to PayPal's decimal string, without ever touching a float. */
function toDecimal(amountMinor: number): string {
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const EVENT_MAP: Record<string, ProviderEventType> = {
  "CHECKOUT.ORDER.APPROVED": "payment.authorised",
  "PAYMENT.CAPTURE.COMPLETED": "payment.captured",
  "PAYMENT.CAPTURE.DENIED": "payment.failed",
  "PAYMENT.CAPTURE.DECLINED": "payment.failed",
  "CHECKOUT.ORDER.VOIDED": "payment.failed",
  "PAYMENT.CAPTURE.REFUNDED": "refund.succeeded",
  "PAYMENT.CAPTURE.REVERSED": "refund.succeeded",
};

export const PayPalProvider: PaymentProvider & { isConfigured: () => boolean } = {
  name: "PAYPAL",

  isConfigured: () => !!clientId() && !!clientSecret() && !!webhookId(),

  async createIntent(args: CreateIntentArgs): Promise<CreatedIntent> {
    // intent CAPTURE, not AUTHORIZE: the whole order is taken at placement, so
    // there is no authorisation sitting around waiting to expire.
    const order = await call("/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: args.orderId,
          custom_id: args.orderId,
          amount: {
            currency_code: args.currency.toUpperCase(),
            value: toDecimal(args.amountMinor),
          },
        },
      ],
    });

    return {
      intentId: String(order.id),
      // PayPal's client SDK takes the order id; there is no separate secret.
      clientSecret: String(order.id),
    };
  },

  async capture(intentId: string): Promise<void> {
    // PayPal captures the order as a whole. The amount is fixed by the order
    // created above, which is why nothing partial is passed here.
    await call(`/v2/checkout/orders/${intentId}/capture`, {});
  },

  async refund(intentId: string, amountMinor: number, reason: string): Promise<RefundResult> {
    // Refunds go against the capture, not the order, so the capture id has to
    // be looked up first.
    const order = await call(`/v2/checkout/orders/${intentId}`, null, "GET");

    const units = order.purchase_units as
      | { payments?: { captures?: { id: string; amount?: { currency_code: string } }[] } }[]
      | undefined;
    const capture = units?.[0]?.payments?.captures?.[0];
    if (!capture) throw new PayPalError(`No capture found for PayPal order ${intentId}`);

    const refund = await call(`/v2/payments/captures/${capture.id}/refund`, {
      amount: {
        value: toDecimal(amountMinor),
        currency_code: capture.amount?.currency_code ?? "EUR",
      },
      note_to_payer: reason.slice(0, 255),
    });

    return { refundId: String(refund.id) };
  },

  async parseWebhook(rawBody: Buffer, signature: string): Promise<ProviderEvent> {
    const id = webhookId();
    if (!id) throw new PayPalError("PAYPAL_WEBHOOK_ID is not configured.");

    /*
     * PayPal verifies webhooks server-side rather than with a local HMAC: the
     * signature lives across five headers, which the route packs into one
     * string for this interface. Verification happens before the body is
     * parsed for anything meaningful.
     */
    const parts = Object.fromEntries(
      (signature ?? "").split("|").map((p) => {
        const [k, ...rest] = p.split("=");
        return [k, rest.join("=")];
      })
    );

    const required = ["transmission_id", "transmission_time", "cert_url", "auth_algo", "transmission_sig"];
    if (required.some((key) => !parts[key])) {
      throw new PayPalSignatureError("Malformed PayPal signature headers.");
    }

    const verification = await call("/v1/notifications/verify-webhook-signature", {
      auth_algo: parts.auth_algo,
      cert_url: parts.cert_url,
      transmission_id: parts.transmission_id,
      transmission_sig: parts.transmission_sig,
      transmission_time: parts.transmission_time,
      webhook_id: id,
      webhook_event: JSON.parse(rawBody.toString("utf8")),
    });

    if (verification.verification_status !== "SUCCESS") {
      throw new PayPalSignatureError("PayPal reported the webhook signature as invalid.");
    }

    const parsed = JSON.parse(rawBody.toString("utf8"));
    const resource = parsed?.resource ?? {};

    // The order id travels as custom_id / supplementary data depending on the
    // event, so it is resolved from whichever is present.
    const intentId =
      resource.supplementary_data?.related_ids?.order_id ??
      resource.id ??
      parsed?.resource?.custom_id ??
      "";

    const amountValue = resource.amount?.value;

    return {
      eventId: String(parsed.id),
      type: EVENT_MAP[String(parsed.event_type)] ?? "unknown",
      intentId: String(intentId),
      reportedAmountMinor:
        typeof amountValue === "string" ? Math.round(Number(amountValue) * 100) : null,
      reportedCurrency: resource.amount?.currency_code ?? null,
      orderItemId: resource.custom_id ?? null,
      raw: parsed,
    };
  },
};

/** Exported for the webhook route, which packs PayPal's five headers into one. */
export function packPayPalSignature(headers: Headers): string {
  return [
    `transmission_id=${headers.get("paypal-transmission-id") ?? ""}`,
    `transmission_time=${headers.get("paypal-transmission-time") ?? ""}`,
    `cert_url=${headers.get("paypal-cert-url") ?? ""}`,
    `auth_algo=${headers.get("paypal-auth-algo") ?? ""}`,
    `transmission_sig=${headers.get("paypal-transmission-sig") ?? ""}`,
  ].join("|");
}

export { createHash };
