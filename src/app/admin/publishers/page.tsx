import { PublisherList } from "@/components/admin/Publishers";
import { requireAdminPage } from "@/lib/data/session";
import { isPricingAdmin } from "@/lib/data/actor";
import { listPublishers } from "@/lib/data/admin-publishers";

export const dynamic = "force-dynamic";

export default async function AdminPublishersPage() {
  // Both staff roles: an editor needs contact details for placements they
  // fulfil. Payout notes and editing are gated to ADMIN in the data layer.
  const actor = await requireAdminPage();
  const publishers = await listPublishers(actor);

  return (
    <div className="shell shell-narrow">
      <PublisherList initial={publishers} canEdit={isPricingAdmin(actor)} />
    </div>
  );
}
