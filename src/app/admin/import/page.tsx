import { CsvImport } from "@/components/admin/CsvImport";
import { requirePricingAdminPage } from "@/lib/data/session";
import { listImports } from "@/lib/data/admin-import";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  // ADMIN only — import sets cost.
  const actor = await requirePricingAdminPage();
  const history = await listImports(actor);

  return (
    <div className="shell shell-narrow">
      <CsvImport
        history={history.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() }))}
      />
    </div>
  );
}
