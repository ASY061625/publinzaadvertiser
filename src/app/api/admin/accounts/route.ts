import { NextResponse } from "next/server";
import type { UserStatus } from "@prisma/client";
import { NOT_FOUND, toErrorResponse } from "@/lib/api-errors";
import { requireStaffApi } from "@/lib/data/session";
import {
  accountCounts,
  listDecidedAccounts,
  listPendingAccounts,
} from "@/lib/data/admin-accounts";

export const dynamic = "force-dynamic";

const DECIDED: UserStatus[] = ["APPROVED", "REJECTED", "SUSPENDED"];

export async function GET(request: Request) {
  const actor = await requireStaffApi();
  if (!actor) return NOT_FOUND();

  try {
    const statusParam = request ? new URL(request.url).searchParams.get("status") : null;

    const accounts =
      statusParam && (DECIDED as string[]).includes(statusParam)
        ? await listDecidedAccounts(actor, statusParam as UserStatus)
        : await listPendingAccounts(actor);

    return NextResponse.json({ accounts, counts: await accountCounts(actor) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
