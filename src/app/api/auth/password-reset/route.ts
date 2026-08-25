import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-errors";
import { requestPasswordReset, resetPassword } from "@/lib/data/accounts";

export const dynamic = "force-dynamic";

const SAME_ANSWER = {
  message: "If that email is registered, a reset link is on its way.",
};

/** Request a reset link. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email : "";

    const token = await requestPasswordReset(email);

    // The same body and status regardless of whether the account exists, so
    // this endpoint cannot be used to enumerate registered emails.
    const payload: Record<string, string> = { ...SAME_ANSWER };

    // There is no mail transport yet, so in development the link is returned
    // directly. Phase 5 wires real email; this must not survive to production.
    if (token && process.env.NODE_ENV !== "production") {
      payload.devResetToken = token;
    }

    return NextResponse.json(payload);
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Complete a reset with the token from the link. */
export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token : "";
    const password = typeof body.password === "string" ? body.password : "";

    await resetPassword(token, password);
    return NextResponse.json({ message: "Password updated. You can sign in now." });
  } catch (err) {
    return toErrorResponse(err);
  }
}
