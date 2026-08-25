import { NextResponse } from "next/server";
import { handleWebhook, WebhookSignatureError } from "@/lib/payments/webhooks";
import { packPayPalSignature } from "@/lib/payments/paypal-provider";

export const dynamic = "force-dynamic";
// The raw body is required for signature verification — any framework-level
// parsing would change the bytes and break it.
export const runtime = "nodejs";

const SIGNATURE_HEADERS = [
  "stripe-signature",
  "x-razorpay-signature",
  "x-webhook-signature",
];

/**
 * PayPal spreads its signature across five headers rather than one. They are
 * packed into a single string here so the provider interface stays uniform —
 * the adapter unpacks them again.
 */
function signatureFor(provider: string, headers: Headers): string {
  if (provider === "PAYPAL") return packPayPalSignature(headers);
  return SIGNATURE_HEADERS.map((h) => headers.get(h)).find((v) => v) ?? "";
}

/**
 * Provider webhook endpoint.
 *
 * Answers 200 quickly for anything already processed, 400 for a bad signature,
 * and never echoes anything about the order back to the caller.
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;

  const signature = signatureFor(provider.toUpperCase(), request.headers);

  const rawBody = Buffer.from(await request.arrayBuffer());

  try {
    const result = await handleWebhook(provider.toUpperCase(), rawBody, signature);
    // A duplicate is a no-op returning 200 — providers retry aggressively and
    // a non-200 would simply bring the same event back again.
    return NextResponse.json({ received: true, duplicate: result.duplicate }, { status: 200 });
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      // Deliberately terse: an attacker probing this endpoint learns nothing.
      return NextResponse.json({ error: "invalid signature" }, { status: 400 });
    }

    console.error("Webhook handling failed", err);
    // 500 so the provider retries; the event id makes the retry idempotent.
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
