import { AccountQueue } from "@/components/admin/AccountQueue";
import { requireAdminPage } from "@/lib/data/session";
import { accountCounts, listPendingAccounts } from "@/lib/data/admin-accounts";

export const dynamic = "force-dynamic";

export default async function AdminAccountsPage() {
  // Guarded here as well as in the layout: they render concurrently, so a
  // layout-only notFound() still streams this page's markup into the 404.
  const actor = await requireAdminPage();

  const [accounts, counts] = await Promise.all([
    listPendingAccounts(actor),
    accountCounts(actor),
  ]);

  return (
    <div className="shell shell-narrow">
      <AccountQueue
        counts={counts}
        initial={accounts.map((a) => ({
          ...a,
          createdAt: a.createdAt.toISOString(),
          statusDecidedAt: a.statusDecidedAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
