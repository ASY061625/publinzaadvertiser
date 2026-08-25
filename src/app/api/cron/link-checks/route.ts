import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/monitoring/cron-auth";
import { runCheckForItem } from "@/lib/monitoring/link-check";
import { dueForCheck } from "@/lib/monitoring/guarantee";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Re-crawls every published URL that is due a check.
 *
 * Cadence lives in dueForCheck: daily for the first week after publication,
 * weekly for the rest of the guarantee window. Running this more often is
 * harmless — an item that is not due is simply skipped.
 */
export async function POST(request: Request) {
  if (!isAuthorisedCron(request)) {
    // 404 rather than 401: an unauthenticated caller should not learn that a
    // cron endpoint lives here.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 200);
  const itemIds = await dueForCheck(Math.min(limit, 500));

  let checked = 0;
  let failures = 0;
  let manualReview = 0;

  for (const itemId of itemIds) {
    try {
      const check = await runCheckForItem(itemId);
      if (!check) continue;
      checked += 1;
      if (check.manualReview) manualReview += 1;
      else if (check.outcome !== "OK") failures += 1;
    } catch (err) {
      // One bad item must not abort the run — the rest of the catalog still
      // needs checking today.
      console.error("Link check failed for item", itemId, err);
    }
  }

  return NextResponse.json({ due: itemIds.length, checked, failures, manualReview });
}
