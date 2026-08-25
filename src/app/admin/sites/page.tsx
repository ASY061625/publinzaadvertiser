import Link from "next/link";
import { SiteList } from "@/components/admin/SiteEditor";
import { requirePricingAdminPage } from "@/lib/data/session";
import { listSitesAdmin } from "@/lib/data/admin-sites";

export const dynamic = "force-dynamic";

export default async function AdminSitesPage() {
  // ADMIN only: this screen shows cost and margin, so an EDITOR gets the 404
  // page here just like an advertiser.
  const actor = await requirePricingAdminPage();
  const sites = await listSitesAdmin(actor, {});

  return (
    <div className="shell shell-narrow">
      <div style={{ padding: "18px 20px 0" }}>
        <p className="crumb">
          <Link href="/admin">← Internal</Link>
        </p>
      </div>
      <SiteList initial={sites} />
    </div>
  );
}
