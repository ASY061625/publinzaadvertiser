import { NextResponse } from "next/server";
import { NOT_FOUND, toErrorResponse } from "@/lib/api-errors";
import { requireStaffApi } from "@/lib/data/session";
import {
  addPublisherNote,
  getPublisher,
  previewReliability,
  recomputeReliability,
  updatePublisher,
} from "@/lib/data/admin-publishers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ publisherId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const actor = await requireStaffApi();
  if (!actor) return NOT_FOUND();

  try {
    const { publisherId } = await params;
    const [publisher, reliability] = await Promise.all([
      getPublisher(actor, publisherId),
      previewReliability(actor, publisherId),
    ]);
    return NextResponse.json({ publisher, reliability });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const actor = await requireStaffApi();
  if (!actor) return NOT_FOUND();

  try {
    const { publisherId } = await params;
    const body = await request.json().catch(() => ({}));

    // Adding a note is open to staff; editing the record is ADMIN-only and the
    // data layer enforces that.
    if (typeof body.note === "string") {
      return NextResponse.json({ note: await addPublisherNote(actor, publisherId, body.note) });
    }
    if (body.action === "recompute") {
      return NextResponse.json({ reliability: await recomputeReliability(publisherId) });
    }

    return NextResponse.json({ publisher: await updatePublisher(actor, publisherId, body) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
