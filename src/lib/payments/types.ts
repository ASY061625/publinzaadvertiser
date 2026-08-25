/**
 * The payment boundary. Nothing outside lib/payments/ may import a provider SDK
 * — everything above this layer speaks only in these types.
 *
 * Amounts are integer minor units (cents, paise) and always travel with their
 * currency. No floats at any layer, ever.
 */

export type ProviderName = "STRIPE" | "RAZORPAY" | "PAYPAL" | "FAKE";

export type Money = {
  amountMinor: number;
  currency: string;
};

export type CreateIntentArgs = {
  orderId: string;
  amountMinor: number;
  currency: string;
  customerRef: string;
};

export type CreatedIntent = {
  intentId: string;
  /** Handed to the provider's hosted fields. A card number never reaches us. */
  clientSecret: string;
};

export type RefundResult = { refundId: string };

/**
 * The normalised event shape. Provider payloads differ wildly; adapters map
 * them onto this so the handler above never branches on provider.
 */
export type ProviderEventType =
  | "payment.authorised"
  | "payment.failed"
  | "payment.captured"
  | "refund.succeeded"
  | "unknown";

export type ProviderEvent = {
  /** The provider's own event id — the idempotency key for webhook handling. */
  eventId: string;
  type: ProviderEventType;
  intentId: string;
  /**
   * The amount the provider claims. Recorded for reconciliation but never
   * trusted over our own stored amount when deciding what to charge.
   */
  reportedAmountMinor: number | null;
  reportedCurrency: string | null;
  /** Present on per-item refunds we initiated. */
  orderItemId: string | null;
  raw: unknown;
};

export interface PaymentProvider {
  readonly name: ProviderName;

  createIntent(args: CreateIntentArgs): Promise<CreatedIntent>;
  capture(intentId: string, amountMinor: number): Promise<void>;
  refund(intentId: string, amountMinor: number, reason: string): Promise<RefundResult>;

  /**
   * Verifies the signature and only then parses. Must throw before reading the
   * body if verification fails — an unsigned webhook is an attacker telling you
   * they paid.
   */
  parseWebhook(rawBody: Buffer, signature: string): Promise<ProviderEvent>;
}

/**
 * The EU and UK, where buyers are routed to PayPal.
 *
 * Kept as an explicit list rather than inferred from currency: a country's
 * payment routing is a commercial decision, and it should be visible and
 * greppable rather than falling out of a lookup somewhere.
 */
const PAYPAL_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE", "GB",
]);

const EURO_COUNTRIES = new Set([
  "AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV",
  "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES",
]);

/**
 * Which provider serves which billing country. Resolved once at placement and
 * stored on the order; never re-resolved, so a customer who moves country
 * cannot break an in-flight refund.
 *
 *   IN            → Razorpay
 *   EU and UK     → PayPal
 *   everywhere else → Stripe (cards)
 */
export function providerForCountry(billingCountry: string | null | undefined): ProviderName {
  if (process.env.PAYMENTS_FORCE_FAKE === "true") return "FAKE";

  const country = (billingCountry ?? "").toUpperCase();
  if (country === "IN") return "RAZORPAY";
  if (PAYPAL_COUNTRIES.has(country)) return "PAYPAL";
  return "STRIPE";
}

/** Currency each provider settles in for a given country. */
export function currencyForCountry(billingCountry: string | null | undefined): string {
  const country = (billingCountry ?? "").toUpperCase();
  if (country === "IN") return "INR";
  if (country === "GB") return "GBP";
  if (EURO_COUNTRIES.has(country)) return "EUR";
  return "USD";
}

export { PAYPAL_COUNTRIES };
