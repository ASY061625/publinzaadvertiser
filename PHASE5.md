# Phase 5 — Money

## Prerequisites — do not start coding without these

1. Registered business entity and business bank account.
2. Approved payment provider account (Razorpay for India; a second route such as
   Paddle or Stripe via a non-India entity if selling globally). Onboarding takes
   weeks — start it before this phase, not during.
3. A decision, taken with an accountant, on whether you hold prepaid customer
   balances. This changes the design substantially.

## Scope decision: pay-per-order first

Ship **pay-per-order**. One payment authorises one order. No stored balance.

Wallets add: holding customer funds (a regulatory question in most
jurisdictions), balance reconciliation, refund-to-balance vs refund-to-card
rules, dormant balance handling, and a ledger that must never drift. None of it
wins a single early customer.

The `Wallet` and `Transaction` tables from the schema stay — the ledger below
writes to them. What is deferred is the *top-up* flow and spending from balance.

## Provider abstraction

One interface, two implementations. Nothing outside `lib/payments/` may import a
provider SDK directly.

```ts
interface PaymentProvider {
  createIntent(args: { orderId, amountMinor, currency, customerRef }): Promise<{ intentId, clientSecret }>
  capture(intentId: string, amountMinor: number): Promise<void>
  refund(intentId: string, amountMinor: number, reason: string): Promise<{ refundId }>
  parseWebhook(rawBody: Buffer, signature: string): Promise<ProviderEvent>
}
```

Route by the advertiser's billing country, resolved once at order placement and
stored on the order. Never re-resolve later — a customer who moves country must
not break an in-flight refund.

## Money handling rules

- **Integer minor units everywhere.** No floats, ever, at any layer.
- **Store the currency with every amount.** A bare integer is a bug waiting.
- If you display USD but charge INR, snapshot the FX rate and both amounts onto
  the order at placement. Never recompute a historical total from today's rate.
- Round once, at the point of charge. Never round intermediate values.

## Order flow with payment

```
DRAFT → PENDING_PAYMENT → IN_PROGRESS → ... → COMPLETE
```

1. Advertiser confirms order → `PENDING_PAYMENT`, payment intent created,
   `ORDER_HOLD` written to the ledger.
2. Provider confirms authorisation via webhook → `IN_PROGRESS`, fulfilment begins.
3. Each item reaching `VERIFIED` → `ORDER_CAPTURE` for that item's snapshot price.
4. Item `REJECTED` or `REFUNDED` → `REFUND` for that item's amount.

Capture per item, not per order. A ten-site order where two placements fail must
charge for eight. This is the single most common source of billing disputes in
this business, and per-order capture makes it unsolvable.

## Webhooks

- **Verify the signature before parsing.** An unsigned webhook is an attacker
  telling you they paid.
- **Idempotent on the provider's event ID.** Store processed event IDs; a repeat
  is a no-op returning 200. Providers retry aggressively and will send duplicates.
- Return 200 fast, process asynchronously. A slow handler gets retried, which
  compounds the duplicate problem.
- Webhooks arrive out of order. Handle a `payment.succeeded` for an order already
  marked paid, and a refund event before its capture event.
- Never trust an amount from the webhook body over your own stored amount.

## Ledger

`Transaction` is **append-only**. No updates, no deletes. Correct mistakes with a
compensating `ADJUSTMENT` row carrying a reason and an actor.

Every row records: type, signed amount in minor units, currency, order ID where
applicable, provider reference, actor, timestamp.

A nightly job asserts that the sum of ledger rows per order equals the provider's
reported net for that order. Any mismatch alerts a human. Silent drift here is
how businesses discover a six-figure hole a year late.

## Invoices

- Generated on capture, immutable once issued, sequentially numbered without gaps.
- Include the buyer's legal name, address, and tax ID (GST/VAT) captured at
  checkout — add these fields to `User`.
- Correct an issued invoice with a credit note, never by editing it.
- Store as generated PDFs; do not re-render on demand from live data, or last
  year's invoice will silently change when a name is updated.

## Card data

Never touches your server. Use the provider's hosted fields or checkout. If a raw
card number can reach your application code, the PCI scope of this project has
just expanded enormously.

## Acceptance tests

1. Replaying an identical webhook event ten times credits the order once.
2. A webhook with an invalid signature is rejected and changes nothing.
3. A ten-item order with two rejected items captures exactly eight items' worth.
4. Ledger rows for any order sum to the expected net.
5. A refund issued before its capture event arrives resolves to the correct net.
6. Changing a site's price after payment does not alter the order or invoice.
7. Invoice numbers are sequential with no gaps across concurrent orders.
8. No route returns `costCents` or margin to an advertiser, including on invoices.
9. A failed payment leaves the order in `PENDING_PAYMENT` with no fulfilment started.
10. A partially captured order that is then fully refunded nets to zero.

## Done when

A real card charge in the provider's test mode flows end to end: order placed,
authorised, two items verified and captured, one rejected and refunded, invoice
issued for the correct amount, ledger reconciles, and every duplicate webhook is
absorbed without effect.
