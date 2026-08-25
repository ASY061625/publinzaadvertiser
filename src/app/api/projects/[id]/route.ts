import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-errors";
import { requireActorApi } from "@/lib/data/session";
import { deleteProject, getProject, updateProject } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Every handler passes the id straight to the data layer, which scopes it to
// the actor. A guessed id therefore 404s exactly like a nonexistent one.

export async function GET(_request: Request, { params }: Params) {
  try {
    const actor = await requireActorApi();
    const { id } = await params;
    return NextResponse.json({ project: await getProject(actor, id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const actor = await requireActorApi();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const project = await updateProject(actor, id, {
      name: body.name,
      targetUrl: body.targetUrl,
      notes: body.notes,
    });

    return NextResponse.json({ project });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const actor = await requireActorApi();
    const { id } = await params;
    await deleteProject(actor, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
