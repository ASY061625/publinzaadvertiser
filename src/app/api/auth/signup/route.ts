import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-errors";
import { createAdvertiser } from "@/lib/data/accounts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    // `role` is never read from the request — createAdvertiser hard-codes it.
    const actor = await createAdvertiser({
      email: body.email,
      password: body.password,
      name: body.name,
      country: body.country,
      companyName: body.companyName,
      companyWebsite: body.companyWebsite,
      jobRole: body.jobRole,
      promoting: body.promoting,
    });

    return NextResponse.json({ user: { id: actor.id, email: actor.email } }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
