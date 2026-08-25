import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-errors";
import { requireActorApi } from "@/lib/data/session";
import { listInvoices } from "@/lib/payments/invoices";
import { netForOrder } from "@/lib/payments/ledger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireActorApi();
    const invoices = await listInvoices(actor);

    // Cost and margin appear nowhere here: the invoice select never includes
    // them, and the net is derived from the ledger's captured amounts.
    const withNet = await Promise.all(
      invoices.map(async (invoice) => ({
        ...invoice,
        net: await netForOrder(invoice.orderId),
      }))
    );

    return NextResponse.json({ invoices: withNet });
  } catch (err) {
    return toErrorResponse(err);
  }
}
