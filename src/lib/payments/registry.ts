import { FakeProvider } from "./fake-provider";
import { StripeProvider } from "./stripe-provider";
import { RazorpayProvider } from "./razorpay-provider";
import { PayPalProvider } from "./paypal-provider";
import type { PaymentProvider, ProviderName } from "./types";

/**
 * The only place a concrete provider is chosen. Everything above resolves one
 * through here by the name stored on the order, never by re-deciding.
 *
 * Falls back to the fake provider when a real one has no keys configured, so
 * local development and the test suite work without an account — and so a
 * missing key is a loud, obvious "FAKE" on the order rather than a crash
 * halfway through a checkout.
 */
export function getProvider(name: ProviderName | string | null | undefined): PaymentProvider {
  switch (name) {
    case "STRIPE":
      return StripeProvider.isConfigured() ? StripeProvider : FakeProvider;
    case "RAZORPAY":
      return RazorpayProvider.isConfigured() ? RazorpayProvider : FakeProvider;
    case "PAYPAL":
      return PayPalProvider.isConfigured() ? PayPalProvider : FakeProvider;
    case "FAKE":
      return FakeProvider;
    default:
      return FakeProvider;
  }
}

export function providerIsLive(name: ProviderName | string | null | undefined): boolean {
  if (name === "STRIPE") return StripeProvider.isConfigured();
  if (name === "RAZORPAY") return RazorpayProvider.isConfigured();
  if (name === "PAYPAL") return PayPalProvider.isConfigured();
  return false;
}
