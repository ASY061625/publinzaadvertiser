import { NextResponse } from "next/server";
import { NOT_FOUND } from "@/lib/api-errors";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/data/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await requireAdminApi();
  // 404, not 401 or 403 — an advertiser probing /api/admin/* learns nothing
  // about which admin endpoints exist.
  if (!actor) return NOT_FOUND();

  const [sites, users, projects] = await Promise.all([
    prisma.site.count(),
    prisma.user.count(),
    prisma.project.count(),
  ]);

  return NextResponse.json({ sites, users, projects });
}
