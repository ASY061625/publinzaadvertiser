import { notFound } from "next/navigation";
import { SiteForm } from "@/components/admin/SiteEditor";
import { requirePricingAdminPage } from "@/lib/data/session";
import { NotFoundError } from "@/lib/data/actor";
import { getSiteForEdit } from "@/lib/data/admin-sites";

export const dynamic = "force-dynamic";

const BLANK = {
  domain: "",
  country: "US",
  language: "en",
  costCents: 0,
  priceCents: 0,
  writingCents: 0,
  turnaroundDays: 7,
};

export default async function SiteEditPage({ params }: { params: Promise<{ siteId: string }> }) {
  await requirePricingAdminPage();
  const { siteId } = await params;

  if (siteId === "new") {
    return (
      <div className="shell shell-narrow">
        <SiteForm site={BLANK} isNew />
      </div>
    );
  }

  const actor = await requirePricingAdminPage();
  let site;
  try {
    site = await getSiteForEdit(actor, siteId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  return (
    <div className="shell shell-narrow">
      <SiteForm
        isNew={false}
        site={{
          ...site,
          priceHistory: site.priceHistory.map((h) => ({
            ...h,
            createdAt: h.createdAt.toISOString(),
          })),
        }}
      />
    </div>
  );
}
