import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { OrderDetail, type HistoryRow } from "@/components/orders/OrderDetail";
import { requireApprovedPage } from "@/lib/data/session";
import { NotFoundError } from "@/lib/data/actor";
import { getOrder } from "@/lib/data/orders";
import { itemHistory } from "@/lib/data/item-status";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireApprovedPage(`/orders/${id}`);

  // getOrder is scoped to the actor, so another user's order id is simply
  // not found — the page 404s rather than confirming it exists.
  let order;
  try {
    order = await getOrder(actor, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const entries = await Promise.all(
    order.items.map(async (item) => {
      const rows = await itemHistory(actor, item.id);
      return [
        item.id,
        rows.map((r) => ({
          id: r.id,
          fromStatus: r.fromStatus,
          toStatus: r.toStatus,
          note: r.note,
          createdAt: r.createdAt.toISOString(),
        })) as HistoryRow[],
      ] as const;
    })
  );

  return (
    <div className="app">
      <TopBar />
      <div className="shell shell-narrow">
        <OrderDetail order={order} history={Object.fromEntries(entries)} />
      </div>
    </div>
  );
}
