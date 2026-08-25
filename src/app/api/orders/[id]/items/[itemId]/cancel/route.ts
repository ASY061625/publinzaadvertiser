import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-errors";
import { requireApprovedApi } from "@/lib/data/session";
import { cancelItem, getOrder } from "@/lib/data/orders";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; itemId: string }> };

/**
 * The only post-placement change an advertiser can make, and only while the
 * item is still QUEUED. Goes through the transition function, so it lands in
 * the audit trail like any other status change.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const actor = await requireApprovedApi();
    const { id, itemId } = await params;

    // Scoped read first: an item id from someone else's order 404s here.
    const order = await getOrder(actor, id);
    if (!order.items.some((i) => i.id === itemId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await cancelItem(actor, itemId);
    return NextResponse.json({ order: await getOrder(actor, id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
