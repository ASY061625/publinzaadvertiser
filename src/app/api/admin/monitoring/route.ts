import { NextResponse } from "next/server";
import { NOT_FOUND, toErrorResponse } from "@/lib/api-errors";
import { requireStaffApi } from "@/lib/data/session";
import { acknowledgeAlert, manualReviewQueue, openAlerts } from "@/lib/monitoring/guarantee";
import { runCheckForItem } from "@/lib/monitoring/link-check";
import { spendToday } from "@/lib/monitoring/metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await requireStaffApi();
  if (!actor) return NOT_FOUND();

  try {
    const [alerts, review, spend] = await Promise.all([
      openAlerts(),
      manualReviewQueue(),
      spendToday(),
    ]);

    return NextResponse.json({
      alerts,
      manualReview: review,
      metricsSpend: spend,
      // Nothing here reaches an advertiser: a first failure is verified by a
      // human before anyone is told their link is gone.
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Acknowledge or resolve an alert, or re-check an item on demand. */
export async function PATCH(request: Request) {
  const actor = await requireStaffApi();
  if (!actor) return NOT_FOUND();

  try {
    const body = await request.json().catch(() => ({}));

    if (body.recheckItemId) {
      const check = await runCheckForItem(String(body.recheckItemId));
      return NextResponse.json({ check });
    }

    if (body.alertId) {
      const alert = await acknowledgeAlert(
        actor,
        String(body.alertId),
        body.resolution ? String(body.resolution) : undefined
      );
      return NextResponse.json({ alert });
    }

    return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
