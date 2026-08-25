import { NextResponse } from "next/server";
import { NOT_FOUND, toErrorResponse } from "@/lib/api-errors";
import { requireStaffApi } from "@/lib/data/session";
import { deactivateSite, getSiteForEdit, reactivateSite, updateSite } from "@/lib/data/admin-sites";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ siteId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const actor = await requireStaffApi();
  if (!actor) return NOT_FOUND();

  try {
    const { siteId } = await params;
    return NextResponse.json({ site: await getSiteForEdit(actor, siteId) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const actor = await requireStaffApi();
  if (!actor) return NOT_FOUND();

  try {
    const { siteId } = await params;
    const body = await request.json().catch(() => ({}));

    if (body.action === "deactivate") {
      return NextResponse.json({ site: await deactivateSite(actor, siteId) });
    }
    if (body.action === "reactivate") {
      return NextResponse.json({ site: await reactivateSite(actor, siteId) });
    }

    const { override, overrideReason, action: _action, ...input } = body;
    const site = await updateSite(actor, siteId, input, { override, overrideReason });
    return NextResponse.json({ site });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Sites are never hard-deleted — existing OrderItem rows reference them and
 * history must stay intact. DELETE deactivates instead, and says so.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const actor = await requireStaffApi();
  if (!actor) return NOT_FOUND();

  try {
    const { siteId } = await params;
    const site = await deactivateSite(actor, siteId);
    return NextResponse.json({
      site,
      note: "Sites are never deleted. This one has been deactivated and removed from the catalog.",
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
