import { NextResponse } from "next/server";
import { NOT_FOUND, toErrorResponse } from "@/lib/api-errors";
import { requireStaffApi } from "@/lib/data/session";
import { createPublisher, listPublishers } from "@/lib/data/admin-publishers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await requireStaffApi();
  if (!actor) return NOT_FOUND();

  try {
    const params = new URL(request.url).searchParams;
    // Reading is open to both staff roles; payoutNotes is omitted for EDITOR
    // inside the data layer.
    return NextResponse.json({ publishers: await listPublishers(actor, { q: params.get("q") }) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  const actor = await requireStaffApi();
  if (!actor) return NOT_FOUND();

  try {
    const body = await request.json().catch(() => ({}));
    const publisher = await createPublisher(actor, body);
    return NextResponse.json({ publisher }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
