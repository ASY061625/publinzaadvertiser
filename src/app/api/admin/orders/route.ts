import { NextResponse } from "next/server";
import type { ItemStatus } from "@prisma/client";
import { NOT_FOUND, toErrorResponse } from "@/lib/api-errors";
import { requireAdminApi } from "@/lib/data/session";
import { bulkAssign, listEditors, listQueue, queueCounts } from "@/lib/data/admin-orders";

export const dynamic = "force-dynamic";

const ITEM_STATUSES = [
  "QUEUED",
  "CONTENT_PENDING",
  "SUBMITTED_TO_PUBLISHER",
  "REVISION_REQUESTED",
  "PUBLISHED",
  "VERIFIED",
  "REFUNDED",
  "REJECTED",
] as const;

export async function GET(request: Request) {
  const actor = await requireAdminApi();
  if (!actor) return NOT_FOUND();

  try {
    const params = new URL(request.url).searchParams;
    const statusParam = params.get("status");
    const status =
      statusParam && (ITEM_STATUSES as readonly string[]).includes(statusParam)
        ? (statusParam as ItemStatus)
        : null;

    const minAgeRaw = params.get("minAgeDays");

    const [items, editors, counts] = await Promise.all([
      listQueue(actor, {
        status,
        assignedToId: params.get("assignedToId"),
        orderId: params.get("orderId"),
        country: params.get("country"),
        // The fulfilment lead's first screen of the morning.
        overdueOnly: params.get("overdue") === "true",
        minAgeDays: minAgeRaw && /^\d+$/.test(minAgeRaw) ? Number(minAgeRaw) : null,
      }),
      listEditors(actor),
      queueCounts(actor),
    ]);

    return NextResponse.json({ items, editors, counts });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Bulk assign a selection to one editor. */
export async function POST(request: Request) {
  const actor = await requireAdminApi();
  if (!actor) return NOT_FOUND();

  try {
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.orderItemIds) ? body.orderItemIds.map(String) : [];
    const editorId = body.editorId ? String(body.editorId) : null;

    return NextResponse.json(await bulkAssign(actor, ids, editorId));
  } catch (err) {
    return toErrorResponse(err);
  }
}
