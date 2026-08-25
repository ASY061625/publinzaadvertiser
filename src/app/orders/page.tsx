import { TopBar } from "@/components/TopBar";
import { OrderList } from "@/components/orders/OrderList";
import { requireApprovedPage } from "@/lib/data/session";
import { listOrders } from "@/lib/data/orders";
import { listProjects } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const actor = await requireApprovedPage("/orders");
  const [{ orders }, projects] = await Promise.all([
    listOrders(actor, {}),
    listProjects(actor),
  ]);

  const withCounts = orders.map((o) => ({ ...o, itemCount: o.items.length }));

  return (
    <div className="app">
      <TopBar />
      <div className="shell shell-narrow">
        <OrderList
          orders={withCounts}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        />
      </div>
    </div>
  );
}
