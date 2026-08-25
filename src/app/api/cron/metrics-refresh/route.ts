import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/monitoring/cron-auth";
import { refreshDueSites } from "@/lib/monitoring/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Refreshes metrics for sites whose tier says they are due, stopping at the
 * daily spend cap.
 *
 * A failed lookup never hides a site or zeroes its metrics — see
 * refreshSiteMetrics. The response reports the cap so a monitor can alert on it.
 */
export async function POST(request: Request) {
  if (!isAuthorisedCron(request)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const limit = Number(params.get("limit") ?? 200);

  const outcome = await refreshDueSites({ limit: Math.min(limit, 1_000) });

  return NextResponse.json(outcome, {
    // A hit cap is not an error, but it is worth making loud in logs and
    // dashboards rather than returning a bland 200.
    status: outcome.capHit ? 207 : 200,
  });
}
