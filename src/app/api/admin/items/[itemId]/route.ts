import { NextResponse } from "next/server";
import type { ItemStatus } from "@prisma/client";
import { NOT_FOUND, toErrorResponse } from "@/lib/api-errors";
import { requireAdminApi } from "@/lib/data/session";
import { assignItem } from "@/lib/data/admin-orders";
import { itemHistory, transitionItem } from "@/lib/data/item-status";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ itemId: string }> };

const ITEM_STATUSES: ItemStatus[] = [
  "QUEUED",
  "CONTENT_PENDING",
  "SUBMITTED_TO_PUBLISHER",
  "REVISION_REQUESTED",
  "PUBLISHED",
  "VERIFIED",
  "REFUNDED",
  "REJECTED",
];

export async function GET(_request: Request, { params }: Params) {
  const actor = await requireAdminApi();
  if (!actor) return NOT_FOUND();

  try {
    const { itemId } = await params;
    return NextResponse.json({ history: await itemHistory(actor, itemId) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Status change and/or assignment. Both go through the shared functions. */
export async function PATCH(request: Request, { params }: Params) {
  const actor = await requireAdminApi();
  if (!actor) return NOT_FOUND();

  try {
    const { itemId } = await params;
    const body = await request.json().catch(() => ({}));

    if (body.assignedToId !== undefined && body.status === undefined) {
      await assignItem(actor, itemId, body.assignedToId ? String(body.assignedToId) : null);
      return NextResponse.json({ history: await itemHistory(actor, itemId) });
    }

    const to = String(body.status ?? "") as ItemStatus;
    if (!ITEM_STATUSES.includes(to)) {
      return NextResponse.json({ error: "Unknown status." }, { status: 400 });
    }

    const result = await transitionItem(actor, itemId, to, {
      note: body.note == null ? null : String(body.note),
      publishedUrl: body.publishedUrl == null ? null : String(body.publishedUrl),
      ...(body.assignedToId !== undefined
        ? { assignedToId: body.assignedToId ? String(body.assignedToId) : null }
        : {}),
    });

    return NextResponse.json({
      status: result.item.status,
      orderStatus: result.orderStatus,
      history: await itemHistory(actor, itemId),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
