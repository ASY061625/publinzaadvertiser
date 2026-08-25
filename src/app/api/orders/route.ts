import { NextResponse } from "next/server";
import type { OrderStatus } from "@prisma/client";
import { toErrorResponse } from "@/lib/api-errors";
import { requireApprovedApi } from "@/lib/data/session";
import { listOrders, placeOrder, type PlacementItem } from "@/lib/data/orders";

export const dynamic = "force-dynamic";

const ORDER_STATUSES = [
  "DRAFT",
  "PENDING_PAYMENT",
  "IN_PROGRESS",
  "PARTIALLY_COMPLETE",
  "COMPLETE",
  "CANCELLED",
] as const;

export async function GET(request: Request) {
  try {
    const actor = await requireApprovedApi();
    const params = new URL(request.url).searchParams;

    const statusParam = params.get("status");
    const status =
      statusParam && (ORDER_STATUSES as readonly string[]).includes(statusParam)
        ? (statusParam as OrderStatus)
        : null;

    return NextResponse.json(
      await listOrders(actor, { projectId: params.get("projectId"), status })
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireApprovedApi();
    const body = await request.json().catch(() => ({}));

    const items: PlacementItem[] = Array.isArray(body.items)
      ? body.items.map((i: Record<string, unknown>) => ({
          siteId: String(i.siteId ?? ""),
          targetUrl: String(i.targetUrl ?? ""),
          anchorText: String(i.anchorText ?? ""),
          contentSource: i.contentSource === "PLATFORM" ? "PLATFORM" : "ADVERTISER",
          briefNotes: i.briefNotes == null ? null : String(i.briefNotes),
          articleUrl: i.articleUrl == null ? null : String(i.articleUrl),
        }))
      : [];

    const order = await placeOrder(actor, {
      idempotencyKey: String(body.idempotencyKey ?? ""),
      projectId: String(body.projectId ?? ""),
      items,
    });

    // A replayed key is not a new order, so it answers 200 rather than 201.
    return NextResponse.json(order, { status: order.reused ? 200 : 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
