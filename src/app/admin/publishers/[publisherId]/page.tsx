import { notFound } from "next/navigation";
import { PublisherDetail } from "@/components/admin/Publishers";
import { requireAdminPage } from "@/lib/data/session";
import { NotFoundError, isPricingAdmin } from "@/lib/data/actor";
import { getPublisher } from "@/lib/data/admin-publishers";

export const dynamic = "force-dynamic";

export default async function PublisherPage({
  params,
}: {
  params: Promise<{ publisherId: string }>;
}) {
  const actor = await requireAdminPage();
  const { publisherId } = await params;

  let publisher;
  try {
    publisher = await getPublisher(actor, publisherId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  return (
    <div className="shell shell-narrow">
      <PublisherDetail
        canEdit={isPricingAdmin(actor)}
        publisher={{
          ...publisher,
          notes: publisher.notes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
        }}
      />
    </div>
  );
}
