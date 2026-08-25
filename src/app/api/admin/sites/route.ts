import { NextResponse } from "next/server";
import { NOT_FOUND, toErrorResponse } from "@/lib/api-errors";
import { requireStaffApi } from "@/lib/data/session";
import { createSite, listSitesAdmin } from "@/lib/data/admin-sites";

export const dynamic = "force-dynamic";

// Pricing routes. The data layer refuses anyone who is not ADMIN with a
// NotFoundError, so an EDITOR gets 404 here exactly like an advertiser.

export async function GET(request: Request) {
  const actor = await requireStaffApi();
  if (!actor) return NOT_FOUND();

  try {
    const params = new URL(request.url).searchParams;
    const activeParam = params.get("isActive");

    return NextResponse.json({
      sites: await listSitesAdmin(actor, {
        q: params.get("q"),
        isActive: activeParam === null ? null : activeParam === "true",
        publisherId: params.get("publisherId"),
      }),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  const actor = await requireStaffApi();
  if (!actor) return NOT_FOUND();

  try {
    const body = await request.json().catch(() => ({}));
    const site = await createSite(actor, body);
    return NextResponse.json({ site }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
