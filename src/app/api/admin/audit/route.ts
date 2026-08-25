import { NextResponse } from "next/server";
import { NOT_FOUND, toErrorResponse } from "@/lib/api-errors";
import { requireStaffApi } from "@/lib/data/session";
import { listAuditLog, type AuditEntity } from "@/lib/data/audit";

export const dynamic = "force-dynamic";

const ENTITIES = ["Site", "Publisher", "OrderItem", "Import"] as const;

export async function GET(request: Request) {
  const actor = await requireStaffApi();
  if (!actor) return NOT_FOUND();

  try {
    const params = new URL(request.url).searchParams;
    const entityParam = params.get("entityType");
    const entityType =
      entityParam && (ENTITIES as readonly string[]).includes(entityParam)
        ? (entityParam as AuditEntity)
        : null;

    // listAuditLog is ADMIN-only — before/after snapshots carry cost.
    return NextResponse.json({
      entries: await listAuditLog(actor, {
        entityType,
        entityId: params.get("entityId"),
        actorUserId: params.get("actorUserId"),
      }),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
