import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-errors";
import { requireApprovedApi } from "@/lib/data/session";
import { beginCheckout } from "@/lib/payments/checkout";
import { providerIsLive } from "@/lib/payments/registry";

export const dynamic = "force-dynamic";

/**
 * Creates (or returns) the payment intent for an order.
 *
 * The client secret goes to the provider's hosted fields. A card number never
 * reaches this application — doing so would expand the PCI scope of the whole
 * project enormously.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireApprovedApi();
    const body = await request.json().catch(() => ({}));

    const handle = await beginCheckout(actor, String(body.orderId ?? ""));

    return NextResponse.json({
      orderId: handle.orderId,
      clientSecret: handle.clientSecret,
      provider: handle.provider,
      amountMinor: handle.amountMinor,
      currency: handle.currency,
      // Tells the UI whether this is a real provider session or the local
      // fake, so a developer is never unsure which one they just exercised.
      live: providerIsLive(handle.provider),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
