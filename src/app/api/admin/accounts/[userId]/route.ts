import { NextResponse } from "next/server";
import { NOT_FOUND, toErrorResponse } from "@/lib/api-errors";
import { requireStaffApi } from "@/lib/data/session";
import { decideAccount, type AccountDecision } from "@/lib/data/admin-accounts";

export const dynamic = "force-dynamic";

const DECISIONS: AccountDecision[] = ["approve", "reject", "suspend", "reinstate"];

/**
 * Records an approval decision.
 *
 * Anyone who is not staff gets a 404 — including the account holder trying to
 * approve themselves, which must look identical to the route not existing.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const actor = await requireStaffApi();
  if (!actor) return NOT_FOUND();

  try {
    const { userId } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (!(DECISIONS as string[]).includes(action)) {
      return NextResponse.json(
        { error: `action must be one of: ${DECISIONS.join(", ")}` },
        { status: 400 }
      );
    }

    const updated = await decideAccount(
      actor,
      userId,
      action as AccountDecision,
      typeof body.note === "string" ? body.note : null
    );

    return NextResponse.json({ account: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
