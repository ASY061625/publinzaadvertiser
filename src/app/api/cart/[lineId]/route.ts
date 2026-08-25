import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-errors";
import { requireApprovedApi } from "@/lib/data/session";
import { removeFromCart } from "@/lib/data/cart";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ lineId: string }> }) {
  try {
    const actor = await requireApprovedApi();
    const { lineId } = await params;
    return NextResponse.json(await removeFromCart(actor, lineId));
  } catch (err) {
    return toErrorResponse(err);
  }
}
