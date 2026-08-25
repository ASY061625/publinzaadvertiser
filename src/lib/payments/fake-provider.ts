import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  CreateIntentArgs,
  CreatedIntent,
  PaymentProvider,
  ProviderEvent,
  ProviderEventType,
  RefundResult,
} from "./types";

/**
 * A deterministic in-memory provider used by the test suite and by local
 * development before real keys exist.
 *
 * It implements the same signature verification and event shape as the real
 * adapters, so the ledger, capture and idempotency logic is exercised for real
 * rather than stubbed out. What it does not do is move money.
 */

const SECRET = process.env.FAKE_PROVIDER_SECRET ?? "fake-provider-signing-secret";

type Intent = {
  intentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  capturedMinor: number;
  refundedMinor: number;
  status: "requires_payment" | "authorised" | "failed";
};

const intents = new Map<string, Intent>();

export function resetFakeProvider() {
  intents.clear();
}

export function fakeIntent(intentId: string): Intent | undefined {
  return intents.get(intentId);
}

function sign(body: Buffer): string {
  return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

export class WebhookVerificationFailed extends Error {}

function verify(rawBody: Buffer, signature: string) {
  const expected = Buffer.from(sign(rawBody), "utf8");
  const supplied = Buffer.from(signature ?? "", "utf8");

  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new WebhookVerificationFailed("Signature does not match the request body.");
  }
}

export const FakeProvider: PaymentProvider & {
  buildEvent: (
    type: ProviderEventType,
    args: {
      intentId: string;
      amountMinor: number;
      currency: string;
      orderItemId?: string;
      eventId?: string;
    }
  ) => { eventId: string; rawBody: Buffer; signature: string };
  markAuthorised: (intentId: string) => void;
} = {
  name: "FAKE",

  async createIntent(args: CreateIntentArgs): Promise<CreatedIntent> {
    const intentId = `fake_pi_${randomUUID()}`;
    intents.set(intentId, {
      intentId,
      orderId: args.orderId,
      amountMinor: args.amountMinor,
      currency: args.currency,
      capturedMinor: 0,
      refundedMinor: 0,
      status: "requires_payment",
    });
    return { intentId, clientSecret: `${intentId}_secret` };
  },

  async capture(intentId: string, amountMinor: number): Promise<void> {
    const intent = intents.get(intentId);
    if (!intent) throw new Error(`Unknown intent ${intentId}`);
    intent.capturedMinor += amountMinor;
  },

  async refund(intentId: string, amountMinor: number): Promise<RefundResult> {
    const intent = intents.get(intentId);
    if (!intent) throw new Error(`Unknown intent ${intentId}`);
    intent.refundedMinor += amountMinor;
    return { refundId: `fake_re_${randomUUID()}` };
  },

  async parseWebhook(rawBody: Buffer, signature: string): Promise<ProviderEvent> {
    // Verification happens before anything reads the body.
    verify(rawBody, signature);

    const parsed = JSON.parse(rawBody.toString("utf8"));
    return {
      eventId: String(parsed.id),
      type: (parsed.type ?? "unknown") as ProviderEventType,
      intentId: String(parsed.data?.intentId ?? ""),
      reportedAmountMinor:
        typeof parsed.data?.amountMinor === "number" ? parsed.data.amountMinor : null,
      reportedCurrency: parsed.data?.currency ?? null,
      orderItemId: parsed.data?.orderItemId ?? null,
      raw: parsed,
    };
  },

  /** Test helper: builds a correctly signed event body. */
  buildEvent(type, args) {
    const eventId = args.eventId ?? `fake_evt_${randomUUID()}`;
    const body = Buffer.from(
      JSON.stringify({
        id: eventId,
        type,
        data: {
          intentId: args.intentId,
          amountMinor: args.amountMinor,
          currency: args.currency,
          ...(args.orderItemId ? { orderItemId: args.orderItemId } : {}),
        },
      }),
      "utf8"
    );
    return { eventId, rawBody: body, signature: sign(body) };
  },

  markAuthorised(intentId: string) {
    const intent = intents.get(intentId);
    if (intent) intent.status = "authorised";
  },
};
