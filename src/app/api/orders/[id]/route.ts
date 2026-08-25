import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-errors";
import { requireApprovedApi } from "@/lib/data/session";
import { getOrder } from "@/lib/data/orders";
import { itemHistory } from "@/lib/data/item-status";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApprovedApi();
    const { id } = await params;

    const order = await getOrder(actor, id);
    const history = Object.fromEntries(
      await Promise.all(
        order.items.map(async (item) => [item.id, await itemHistory(actor, item.id)] as const)
      )
    );

    return NextResponse.json({ order, history });
  } catch (err) {
    return toErrorResponse(err);
  }
}
