import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-errors";
import { requireActorApi } from "@/lib/data/session";
import { getInvoicePdfPath } from "@/lib/payments/invoices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Serves the stored PDF bytes. Deliberately not re-rendered from live data —
 * doing so would mean last year's invoice silently changes when a name is
 * updated. The lookup is scoped to the actor, so another user's invoice id 404s.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const actor = await requireActorApi();
    const { invoiceId } = await params;

    const path = await getInvoicePdfPath(actor, invoiceId);
    const bytes = await readFile(path);

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${invoiceId}.pdf"`,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
