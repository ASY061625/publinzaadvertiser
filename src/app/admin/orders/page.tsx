import Link from "next/link";
import { OrderQueue } from "@/components/admin/OrderQueue";
import { requireAdminPage } from "@/lib/data/session";
import { listEditors, listQueue, queueCounts } from "@/lib/data/admin-orders";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  // Guarded here as well as in the layout: layout and page render concurrently,
  // so a layout-only guard still streams this page's markup into the 404.
  const actor = await requireAdminPage();

  const [items, editors, counts] = await Promise.all([
    listQueue(actor, {}),
    listEditors(actor),
    queueCounts(actor),
  ]);

  return (
    <div className="shell shell-narrow">
      <div style={{ padding: "18px 20px 0" }}>
        <p className="crumb">
          <Link href="/admin">← Internal</Link>
        </p>
      </div>
      <OrderQueue initialItems={items} editors={editors} counts={counts} />
    </div>
  );
}
