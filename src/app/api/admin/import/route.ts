import { NextResponse } from "next/server";
import { NOT_FOUND, toErrorResponse } from "@/lib/api-errors";
import { requireStaffApi } from "@/lib/data/session";
import { commitImport, dryRunImport, listImports } from "@/lib/data/admin-import";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await requireStaffApi();
  if (!actor) return NOT_FOUND();

  try {
    return NextResponse.json({ imports: await listImports(actor) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * `POST { csv }` is the dry run — it reports what would happen and writes
 * nothing. Only `POST { csv, confirm: true }` commits, and that runs in one
 * transaction which rolls back whole if any row fails.
 */
export async function POST(request: Request) {
  const actor = await requireStaffApi();
  if (!actor) return NOT_FOUND();

  try {
    const body = await request.json().catch(() => ({}));
    const csv = typeof body.csv === "string" ? body.csv : "";
    const fileName = typeof body.fileName === "string" ? body.fileName : "upload.csv";

    if (!csv.trim()) {
      return NextResponse.json({ error: "No CSV content received." }, { status: 400 });
    }

    if (!body.confirm) {
      const preview = await dryRunImport(actor, csv);
      // The parsed rows are not echoed back — the counts and errors are what
      // the confirmation screen needs, and the payload carries cost data.
      return NextResponse.json({
        dryRun: true,
        created: preview.created,
        updated: preview.updated,
        unchanged: preview.unchanged,
        errors: preview.errors,
      });
    }

    const result = await commitImport(actor, csv, fileName);
    return NextResponse.json({ dryRun: false, ...result });
  } catch (err) {
    return toErrorResponse(err);
  }
}
