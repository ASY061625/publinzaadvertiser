import { NextResponse } from "next/server";
import { FilterError, parseFilters } from "@/lib/catalog/filters";
import { countCatalog, queryCatalog } from "@/lib/catalog/query";
import { NOT_FOUND } from "@/lib/api-errors";
import { requireApprovedApi } from "@/lib/data/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  // The catalog is not public. An unapproved or signed-out caller gets the same
  // 404 as a route that does not exist, so account status cannot be probed by
  // comparing status codes.
  let actor;
  try {
    actor = await requireApprovedApi();
  } catch {
    return NOT_FOUND();
  }

  let filters;
  try {
    filters = parseFilters(params);
  } catch (err) {
    if (err instanceof FilterError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  try {
    // Timed and reported as Server-Timing so the latency gate can measure the
    // catalog query itself rather than whatever the surrounding server adds.
    // In `next dev` that overhead is 70ms+ and grows with the route count,
    // which would otherwise make the gate look like a query regression.
    const started = performance.now();
    const [{ sites, nextCursor }, total] = await Promise.all([
      queryCatalog(actor, filters),
      countCatalog(actor, filters),
    ]);
    const durationMs = performance.now() - started;

    return NextResponse.json(
      { sites, nextCursor, total },
      { headers: { "server-timing": `db;dur=${durationMs.toFixed(1)}` } }
    );
  } catch (err) {
    if (err instanceof FilterError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // Never let a driver error echo a row (and therefore costCents) back out.
    console.error("GET /api/sites failed", err);
    return NextResponse.json({ error: "catalog query failed" }, { status: 500 });
  }
}
