import { TopBar } from "@/components/TopBar";
import { Checkout } from "@/components/orders/Checkout";
import { requireApprovedPage } from "@/lib/data/session";
import { getCart } from "@/lib/data/cart";
import { listProjects } from "@/lib/data/projects";
import { resolveCurrentProject } from "@/lib/data/current-project";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const actor = await requireApprovedPage("/checkout");

  const [cart, projects, { current }] = await Promise.all([
    getCart(actor),
    listProjects(actor),
    resolveCurrentProject(actor),
  ]);

  return (
    <div className="app">
      <TopBar />
      <div className="shell shell-narrow">
        <Checkout
          cart={cart}
          projects={projects.map((p) => ({ id: p.id, name: p.name, targetUrl: p.targetUrl }))}
          defaultProjectId={current?.id ?? null}
        />
      </div>
    </div>
  );
}
