import type { Actor } from "@/lib/data/actor";
import { placeOrder, type PlaceOrderInput } from "@/lib/data/orders";
import { authorisePayment, beginCheckout } from "@/lib/payments/checkout";
import { FakeProvider } from "@/lib/payments/fake-provider";
import type { Client } from "./client";

/**
 * From Phase 5 an order is placed as PENDING_PAYMENT and cannot be fulfilled
 * until its payment is authorised. Tests written before payments existed placed
 * an order and drove it straight to VERIFIED; they now go through here instead.
 */
export async function placeAndAuthorise(actor: Actor, input: PlaceOrderInput) {
  const order = await placeOrder(actor, input);
  const checkout = await beginCheckout(actor, order.id);
  await authorisePayment(checkout.intentId);
  return order;
}

/**
 * The same thing over HTTP: begins checkout, then delivers a correctly signed
 * authorisation webhook. This exercises the real webhook path rather than
 * flipping the status directly, which is closer to what a provider does.
 *
 * The fake provider's signing secret is shared by env, so an event signed in
 * the test process verifies in the dev server process.
 */
export async function authoriseOverHttp(client: Client, orderId: string) {
  const res = await client.fetch("/api/payments/checkout", {
    method: "POST",
    body: JSON.stringify({ orderId }),
  });
  if (!res.ok) throw new Error(`checkout failed: ${res.status} ${await res.text()}`);
  const { clientSecret } = await res.json();

  // The fake provider hands back "<intentId>_secret".
  const intentId = String(clientSecret).replace(/_secret$/, "");

  const event = FakeProvider.buildEvent("payment.authorised", {
    intentId,
    amountMinor: 0, // never trusted over our stored amount
    currency: "USD",
  });

  const hook = await client.fetch("/api/payments/webhook/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-signature": event.signature },
    body: event.rawBody.toString("utf8"),
  });
  if (!hook.ok) throw new Error(`webhook failed: ${hook.status} ${await hook.text()}`);

  return { intentId };
}
