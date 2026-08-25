import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-errors";
import { requireActorApi } from "@/lib/data/session";
import { createProject, listProjects } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireActorApi();
    return NextResponse.json({ projects: await listProjects(actor) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActorApi();
    const body = await request.json().catch(() => ({}));

    // Only these three fields are read. A userId in the payload is ignored —
    // ownership comes from the actor.
    const project = await createProject(actor, {
      name: body.name,
      targetUrl: body.targetUrl,
      notes: body.notes,
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
