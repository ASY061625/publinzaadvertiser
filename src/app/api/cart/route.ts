import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-errors";
import { requireApprovedApi } from "@/lib/data/session";
import { addToCart, clearCart, getCart } from "@/lib/data/cart";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireApprovedApi();
    return NextResponse.json(await getCart(actor));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireApprovedApi();
    const body = await request.json().catch(() => ({}));
    const cart = await addToCart(actor, {
      siteId: String(body.siteId ?? ""),
      projectId: String(body.projectId ?? ""),
    });
    return NextResponse.json(cart, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const actor = await requireApprovedApi();
    return NextResponse.json(await clearCart(actor));
  } catch (err) {
    return toErrorResponse(err);
  }
}
